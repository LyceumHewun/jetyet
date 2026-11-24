import { Hono, type Context } from "hono";
import { z } from "zod";
import { counted, usage } from "../accounting";
import { digest } from "../crypto";
import { strip, type Entity, type Store } from "../db";
import { HttpError, requireOrigin } from "../errors";
import {
  formatLinks,
  subscriptionLink,
  subscriptionNodes,
} from "../subscriptions";
import { render, validateCore } from "../templates";

const personalKind = "personal-template";
const title = z.string().trim().min(1).max(100);
const isExpired = (user: Entity) =>
  !!user.expires && Date.parse(user.expires) <= Date.now();
function availableTemplate(s: Store, user: Entity, id: string) {
  const t = s.get(id);
  if (!t || t.deleted) return null;
  const personal = t.kind === personalKind && t.owner === user.id;
  return personal ||
    (t.kind === "template" && t.published && user.templateIds.includes(id))
    ? t
    : null;
}

export function subscriptionTemplate(s: Store, user: Entity, id: string) {
  const t = availableTemplate(s, user, id);
  return t?.published ? t : null;
}

function templateSummary(t: Entity) {
  const personal = t.kind === personalKind;
  return {
    id: t.id,
    name: personal ? (t.draftName ?? t.name) : t.name,
    personal,
    format: t.format,
    published: t.published,
    draft: personal && typeof t.draft === "string",
  };
}

function portalTraffic(s: Store, user: Entity) {
  const current = usage(s, user);
  const hour = 3600000;
  const now = Date.now();
  const start = Math.floor(now / hour) * hour - 23 * hour;
  const rows = s.db
    .query<
      { at: number; inbound: number; outbound: number },
      [number, number, string, number, number]
    >(
      `SELECT (at / ?) * ? AS at,
              SUM(inbound) AS inbound,
              SUM(outbound) AS outbound
       FROM samples
       WHERE entity = ? AND resolution = 'minute' AND at BETWEEN ? AND ?
       GROUP BY 1
       ORDER BY 1`,
    )
    .all(hour, hour, user.id, start, now);
  const byHour = new Map(rows.map((row) => [row.at, row]));
  const samples = rows.length
    ? Array.from({ length: 24 }, (_, index) => {
        const at = start + index * hour;
        return byHour.get(at) ?? { at, inbound: 0, outbound: 0 };
      })
    : [];
  return {
    inbound: current.inbound,
    outbound: current.outbound,
    used: counted(user.quota, current),
    limit: user.quota.limit,
    direction: user.quota.direction,
    periodStart: current.start,
    nextReset: current.next,
    samples,
  };
}

export function portalOverview(s: Store, user: Entity) {
  const assigned = (user.templateIds as string[])
    .map((id) => subscriptionTemplate(s, user, id))
    .filter((t) => t !== null);
  const personal = s.list(personalKind).filter((t) => t.owner === user.id);
  const expired = isExpired(user);
  const base =
    !expired && subscriptionNodes(s, user).length
      ? subscriptionLink(s, user)
      : null;
  return {
    name: user.name,
    expired,
    defaultLink: base,
    formats: base ? formatLinks(base) : null,
    defaultTemplates: user.defaultTemplates,
    templates: [...assigned, ...personal].map(templateSummary),
    traffic: portalTraffic(s, user),
  };
}

export function registerPortalRoutes(
  app: Hono,
  s: Store,
  sessionUser: (c: Context) => Entity | null,
) {
  const portal = new Hono<{ Variables: { user: Entity } }>();
  portal.use("*", async (c, next) => {
    const user = sessionUser(c);
    if (!user) throw new HttpError(401, "Sign in required");
    if (c.req.method !== "GET" && c.req.method !== "HEAD")
      requireOrigin(c.req.raw, s.config.origin);
    c.set("user", user);
    await next();
  });
  function template(user: Entity, id: string, personalOnly = false) {
    const t = availableTemplate(s, user, id);
    if (!t || (personalOnly && t.kind !== personalKind))
      throw new HttpError(404, "Template unavailable");
    return t;
  }
  portal.get("/", (c) => c.json(portalOverview(s, c.get("user"))));
  portal.get("/templates/:id", (c) => {
    const user = c.get("user");
    const t = template(user, c.req.param("id"));
    const summary = templateSummary(t);
    const link =
      !isExpired(user) && t.published && subscriptionNodes(s, user).length
        ? `${subscriptionLink(s, user)}?template=${t.id}`
        : null;
    return c.json({
      ...summary,
      link,
      body: summary.personal ? (t.draft ?? t.body) : null,
    });
  });
  portal.post("/templates", async (c) => {
    const { sourceId, name } = z
      .object({ sourceId: z.uuid(), name: title })
      .parse(await c.req.json());
    return c.json(
      s.db
        .transaction(() => {
          const user = sessionUser(c);
          if (!user) throw new HttpError(401, "Sign in required");
          const source = subscriptionTemplate(s, user, sourceId);
          if (!source)
            throw new HttpError(404, "Published source template unavailable");
          const t = s.put(personalKind, {
            owner: user.id,
            format: source.format,
            name,
            body: "",
            draft: source.body,
            published: false,
          });
          return { ...templateSummary(t), body: source.body };
        })
        .immediate(),
      201,
    );
  });
  portal.put("/templates/:id", async (c) => {
    const { name, body } = z
      .object({
        name: title,
        body: z.string().max(100000),
      })
      .parse(await c.req.json());
    return c.json(
      s.db
        .transaction(() => {
          const user = sessionUser(c);
          if (!user) throw new HttpError(401, "Sign in required");
          const t = template(user, c.req.param("id"), true);
          const hasDraft = name !== t.name || body !== t.body || !t.published;
          const next = s.put(
            personalKind,
            {
              ...strip(t),
              draftName: hasDraft ? name : null,
              draft: hasDraft ? body : null,
              previewed: null,
            },
            undefined,
            t.id,
          );
          return templateSummary(next);
        })
        .immediate(),
    );
  });
  function preview(
    user: Entity,
    body: string,
    personal: boolean,
    format: Entity["format"],
  ) {
    try {
      return render(
        s,
        user,
        body,
        personal ? "portal-preview" : "assigned-preview",
        format,
      );
    } catch {
      throw new HttpError(
        422,
        "Template validation failed. Check configuration syntax, groups, and rules.",
      );
    }
  }
  portal.post("/templates/:id/preview", (c) => {
    const user = c.get("user");
    const t = template(user, c.req.param("id"));
    const draft = t.kind === personalKind ? t.draft : null;
    const body = draft ?? t.body;
    const text = preview(user, body, t.kind === personalKind, t.format);
    if (typeof draft === "string")
      s.put(
        personalKind,
        { ...strip(t), previewed: digest(draft) },
        undefined,
        t.id,
      );
    return c.json({ text });
  });
  portal.post("/templates/:id/publish", async (c) => {
    const user = c.get("user");
    const draft = template(user, c.req.param("id"), true);
    if (
      typeof draft.draft !== "string" ||
      draft.previewed !== digest(draft.draft)
    )
      throw new HttpError(409, "Preview the saved draft before publishing");
    const configuration = render(s, user, draft.draft, "live", draft.format);
    await validateCore(s, configuration, draft.format);
    const published = s.db
      .transaction(() => {
        const currentUser = sessionUser(c);
        if (!currentUser) throw new HttpError(401, "Sign in required");
        const t = template(currentUser, c.req.param("id"), true);
        if (
          t.draft !== draft.draft ||
          t.draftName !== draft.draftName ||
          t.previewed !== draft.previewed ||
          render(s, currentUser, t.draft, "live", t.format) !== configuration
        )
          throw new HttpError(409, "Preview the saved draft before publishing");
        return s.put(
          personalKind,
          {
            ...strip(t),
            name: t.draftName ?? t.name,
            body: t.draft,
            draft: null,
            draftName: null,
            previewed: null,
            published: true,
          },
          undefined,
          t.id,
        );
      })
      .immediate();
    return c.json(templateSummary(published));
  });
  app.route("/api/portal", portal);
}
