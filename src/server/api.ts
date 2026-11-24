import { Hono } from "hono";
import { z } from "zod";
import {
  exhausted,
  nodeAllowed,
  refreshPeriods,
  usage,
  userAllowed,
} from "./accounting";
import { digest, same } from "./crypto";
import { type Entity, type Store } from "./db";
import { HttpError, requireOrigin, safeError } from "./errors";
import { registerSignIn } from "./sign-in";
import { registerPortalRoutes, subscriptionTemplate } from "./routes/portal";
import { registerAccountingRoutes } from "./routes/accounting";
import { registerHostsRoutes } from "./routes/hosts";
import { registerNodesRoutes } from "./routes/nodes";
import { registerOperationsRoutes } from "./routes/operations";
import { registerTemplatesRoutes } from "./routes/templates";
import { registerUsersRoutes } from "./routes/users";
import { render, seedTemplate, validateCore } from "./templates";
import {
  clientFormat,
  renderShadowrocket,
  subscriptionFormats,
  subscriptionNodes,
} from "./subscriptions";
import type { TemplateFormat } from "../shared/schemas";

export function createApp(s: Store) {
  seedTemplate(s);
  const app = new Hono();
  const entity = (id: string, kind?: string) => {
    const e = s.get(id);
    if (!e || e.deleted || (kind && e.kind !== kind))
      throw new HttpError(404, "Record not found");
    return e;
  };
  app.onError((err, c) => {
    if (err instanceof z.ZodError)
      return c.json(
        {
          error: err.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
          errorKind: "validation",
        },
        400,
      );
    if (err instanceof SyntaxError)
      return c.json({ error: "Invalid JSON payload" }, 400);
    if (err instanceof HttpError)
      return c.json({ error: err.message }, err.status as 400);
    if (
      !c.req.path.startsWith("/api/") ||
      c.req.path === "/api/login" ||
      c.req.path.startsWith("/api/portal")
    )
      return c.json({ error: "Internal server error" }, 500);
    // Remote output can contain secrets. Do not return raw command exceptions.
    return c.json(
      {
        error: safeError(s, err),
      },
      400,
    );
  });
  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cache-Control", "no-store");
    await next();
  });
  const { isAdmin, sessionUser } = registerSignIn(app, s);
  registerPortalRoutes(app, s, sessionUser);
  app.post("/auth/hysteria/:node/:secret", async (c) => {
    const n = s.get(c.req.param("node"));
    if (
      !n ||
      n.kind !== "node" ||
      n.deleted ||
      !same(c.req.param("secret"), s.secrets(n.id).authSecret)
    )
      return c.json({ ok: false }, 403);
    let input: { auth: string };
    try {
      input = z
        .object({ auth: z.string().max(2048) })
        .parse(await c.req.json());
    } catch {
      return c.json({ ok: false }, 400);
    }
    refreshPeriods(s);
    if (!nodeAllowed(s, n)) return c.json({ ok: false });
    if (same(input.auth, s.secrets(n.id).probeToken))
      return c.json({ ok: true, id: `probe:${n.id}` });
    const row = s.db
      .query<{ entity: string }, [string, string]>(
        "SELECT entity FROM token_index WHERE hash=? AND kind=?",
      )
      .get(digest(input.auth), "vpn");
    const candidate = row ? s.get(row.entity) : null;
    const u =
      candidate &&
      candidate.kind === "user" &&
      !candidate.deleted &&
      same(input.auth, s.secrets(candidate.id).vpnToken)
        ? candidate
        : undefined;
    if (u && u.nodeIds.includes(n.id) && userAllowed(s, u)) {
      s.db
        .query("INSERT OR IGNORE INTO first_auth VALUES(?,?,?)")
        .run(n.id, u.id, Date.now());
      return c.json({ ok: true, id: u.id });
    }
    return c.json({ ok: false });
  });
  const checked = (text: string, format: TemplateFormat) =>
    validateCore(s, text, format);
  app.get("/sub/:token", (c) => {
    c.header("Cache-Control", "private, no-store");
    c.header("Vary", "User-Agent");
    const rawToken = c.req.param("token");
    const row = s.db
      .query<{ entity: string }, [string, string]>(
        "SELECT entity FROM token_index WHERE hash=? AND kind=?",
      )
      .get(digest(rawToken), "sub");
    const candidate = row ? s.get(row.entity) : null;
    const u =
      candidate &&
      candidate.kind === "user" &&
      !candidate.deleted &&
      same(rawToken, s.secrets(candidate.id).subscriptionToken)
        ? candidate
        : undefined;
    if (!u || !u.enabled || (u.expires && Date.parse(u.expires) <= Date.now()))
      return c.text("Subscription unavailable", 403);
    refreshPeriods(s);
    const explicit = c.req.query("format");
    if (
      explicit !== undefined &&
      !subscriptionFormats.some((format) => format === explicit)
    )
      return c.text("Unknown subscription format", 400);
    const templateId = c.req.query("template");
    let template =
      templateId === undefined ? null : subscriptionTemplate(s, u, templateId);
    if (templateId !== undefined && !template)
      return c.text("Template unavailable", 403);
    if (template && explicit !== undefined && explicit !== template.format)
      return c.text("Format conflicts with template type", 400);
    const format =
      template?.format ??
      explicit ??
      clientFormat(c.req.header("User-Agent") ?? "");
    if (!format)
      return c.text(
        "Client not recognized. Use a format-specific subscription URL.",
        406,
      );
    const nodes = subscriptionNodes(s, u);
    if (!nodes.length) return c.text("No eligible assigned nodes", 403);
    let text: string;
    try {
      if (format === "shadowrocket") {
        text = renderShadowrocket(nodes, s.secrets(u.id).vpnToken);
      } else {
        template ??= subscriptionTemplate(s, u, u.defaultTemplates?.[format]);
        if (!template || template.format !== format)
          return c.text("Template unavailable", 403);
        text = render(s, u, template.body, "live", format);
      }
    } catch {
      return c.text("Subscription configuration is invalid", 422);
    }
    const use = usage(s, u);
    const upload = u.quota.direction === "out" ? 0 : use.inbound;
    const download = u.quota.direction === "in" ? 0 : use.outbound;
    const title = `Jetyet · ${u.username}`;
    const contentType =
      format === "sing-box"
        ? "application/json"
        : format === "mihomo"
          ? "text/yaml"
          : "text/plain";
    c.header("Content-Type", contentType + "; charset=utf-8");
    c.header(
      "Profile-Title",
      `base64:${Buffer.from(title).toString("base64")}`,
    );
    c.header("Profile-Web-Page-Url", s.config.origin);
    c.header("Support-Url", "https://github.com/LyceumHewun/jetyet");
    c.header(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(title)}`,
    );
    c.header(
      "subscription-userinfo",
      `upload=${upload}; download=${download}; total=${u.quota.limit ?? 0}; expire=${u.expires ? Math.floor(Date.parse(u.expires) / 1000) : 0}`,
    );
    return c.body(text);
  });
  app.use("/api/*", async (c, next) => {
    if (!isAdmin(c)) return c.json({ error: "Sign in required" }, 401);
    if (!["GET", "HEAD"].includes(c.req.method))
      requireOrigin(c.req.raw, s.config.origin);
    refreshPeriods(s);
    await next();
  });
  const view = (e: Entity) => {
    if (!["host", "user"].includes(e.kind)) return { ...e };
    const stale = (last: number | undefined, created: number) =>
      Date.now() - (last || created) > 180000;
    const usageStale =
      e.kind === "host"
        ? !e.deleted &&
          !e.deleting &&
          !!e.fingerprint &&
          e.enabled &&
          stale(e.lastSeen, e.created)
        : !e.deleted &&
          !e.deleting &&
          e.enabled &&
          s
            .list("node")
            .filter(
              (n) =>
                e.nodeIds.includes(n.id) &&
                n.enabled &&
                n.status === "ready" &&
                !n.deleting &&
                n.service !== false &&
                (() => {
                  const h = s.get(n.hostId);
                  return (
                    !!h &&
                    !h.deleted &&
                    !h.deleting &&
                    h.enabled &&
                    !!h.fingerprint
                  );
                })(),
            )
            .some((n) => stale(n.trafficSeen, n.created));
    return { ...e, usage: usage(s, e), exhausted: exhausted(s, e), usageStale };
  };
  app.get("/api/state", (c) => {
    const now = Date.now();
    for (const name of ["monitor", "operations"]) {
      const hb = s.db
        .query<{ at: number }, [string]>(
          "SELECT at FROM heartbeats WHERE name=?",
        )
        .get(name);
      if (!hb || now - hb.at > 30000)
        s.alert(
          "platform",
          `worker-${name}`,
          `${name} worker heartbeat is missing.`,
        );
      else s.resolveAlert("platform", `worker-${name}`);
    }
    return c.json({
      hosts: s.list("host").map(view),
      nodes: s.list("node"),
      users: s.list("user").map(view),
      templates: s.list("template").map((e) => ({
        id: e.id,
        name: e.name,
        published: e.published,
        format: e.format,
        body: e.body,
        draft: e.draft,
      })),
      workers: s.db.query("SELECT * FROM heartbeats").all(),
      alerts: s.db
        .query("SELECT * FROM alerts ORDER BY first DESC LIMIT 300")
        .all(),
      tasks: s.db
        .query("SELECT * FROM tasks ORDER BY created DESC LIMIT 100")
        .all(),
      origin: s.config.origin,
    });
  });
  registerHostsRoutes({ app, s, entity, view, checked });
  registerNodesRoutes({ app, s, entity, view, checked });
  registerUsersRoutes({ app, s, entity, view, checked });
  registerAccountingRoutes({ app, s, entity, view, checked });
  registerTemplatesRoutes({ app, s, entity, view, checked });
  registerOperationsRoutes({ app, s, entity, view, checked });
  return app;
}
