import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
  exhausted,
  nodeAllowed,
  refreshPeriods,
  usage,
  userAllowed,
} from "./accounting";
import { digest, same, token } from "./crypto";
import { type Entity, type Store } from "./db";
import { safeError } from "./errors";
import { registerAccountingRoutes } from "./routes/accounting";
import { registerHostsRoutes } from "./routes/hosts";
import { registerNodesRoutes } from "./routes/nodes";
import { registerOperationsRoutes } from "./routes/operations";
import { registerTemplatesRoutes } from "./routes/templates";
import { registerUsersRoutes } from "./routes/users";
import { render, seedTemplate, validateMihomo } from "./templates";

export function createApp(s: Store) {
  seedTemplate(s);
  const app = new Hono();
  const sessionVersion = digest(
    s.config.admin.username + ":" + s.config.admin.passwordHash,
  );
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
        },
        400,
      );
    if (err instanceof HttpError)
      return c.json({ error: err.message }, err.status as 400);
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
  app.post("/api/login", async (c) => {
    requireOrigin(c.req.raw, s.config.origin);
    const key = digest(c.req.header("x-real-ip") || "local"),
      now = Date.now();
    const limit = s.db
      .query<{ attempts: number; reset: number }, [string]>(
        "SELECT * FROM login_limits WHERE key=?",
      )
      .get(key);
    if (limit && limit.reset > now && limit.attempts >= 10)
      return c.json({ error: "Too many attempts. Retry in 15 minutes." }, 429);
    const { username, password } = z
      .object({ username: z.string().max(100), password: z.string().max(1000) })
      .parse(await c.req.json());
    s.db
      .query(
        "INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset<? THEN 1 ELSE attempts+1 END,reset=CASE WHEN reset<? THEN excluded.reset ELSE reset END",
      )
      .run(key, now + 900000, now, now);
    const valid = await Bun.password.verify(
      password,
      s.config.admin.passwordHash!,
    );
    if (!same(username, s.config.admin.username) || !valid)
      return c.json({ error: "Invalid username or password" }, 401);
    s.db.query("DELETE FROM login_limits WHERE key=?").run(key);
    const t = token(),
      expires = now + 7 * 86400000;
    s.db
      .query("INSERT INTO sessions VALUES(?,?,?)")
      .run(digest(t), sessionVersion, expires);
    setCookie(c, "jetyet", t, {
      httpOnly: true,
      secure: new URL(s.config.origin).protocol === "https:",
      sameSite: "Strict",
      path: "/",
      maxAge: 7 * 86400,
    });
    return c.json({ username });
  });
  app.post("/auth/hysteria/:node/:secret", async (c) => {
    const n = s.get(c.req.param("node"));
    if (
      !n ||
      n.kind !== "node" ||
      n.deleted ||
      !same(c.req.param("secret"), s.secrets(n.id).authSecret)
    )
      return c.json({ ok: false }, 403);
    refreshPeriods(s);
    const input = z
      .object({ auth: z.string().max(2048) })
      .parse(await c.req.json());
    if (!nodeAllowed(s, n)) return c.json({ ok: false });
    if (same(input.auth, s.secrets(n.id).probeToken))
      return c.json({ ok: true, id: `probe:${n.id}` });
    const u = s
      .list("user")
      .find((u) => same(input.auth, s.secrets(u.id).vpnToken));
    if (u && u.nodeIds.includes(n.id) && userAllowed(s, u)) {
      s.db
        .query("INSERT OR IGNORE INTO first_auth VALUES(?,?,?)")
        .run(n.id, u.id, Date.now());
      return c.json({ ok: true, id: u.id });
    }
    return c.json({ ok: false });
  });
  const validated = new Set<string>();
  async function checked(text: string) {
    const h = digest(text);
    if (!validated.has(h)) {
      await validateMihomo(s, text);
      if (validated.size > 1000) validated.clear();
      validated.add(h);
    }
  }
  app.get("/sub/:token", async (c) => {
    const u = s
      .list("user")
      .find((u) =>
        same(c.req.param("token"), s.secrets(u.id).subscriptionToken),
      );
    if (!u || !u.enabled || (u.expires && Date.parse(u.expires) <= Date.now()))
      return c.text("Subscription unavailable", 403);
    refreshPeriods(s);
    const id = c.req.query("template") || u.defaultTemplate;
    if (!u.templateIds.includes(id)) return c.text("Template unavailable", 403);
    const template = s.get(id);
    if (!template || template.deleted || !template.published)
      return c.text("Template unavailable", 404);
    const text = render(s, u, template.body);
    await checked(text);
    const use = usage(s, u);
    c.header("Content-Type", "text/yaml; charset=utf-8");
    c.header(
      "subscription-userinfo",
      `upload=${use.inbound}; download=${use.outbound}; total=${u.quota.limit ?? 0}; expire=${u.expires ? Math.floor(Date.parse(u.expires) / 1000) : 0}`,
    );
    return c.body(text);
  });
  app.use("/api/*", async (c, next) => {
    const t = getCookie(c, "jetyet");
    const session = t
      ? s.db
          .query<{ version: string; expires: number }, [string]>(
            "SELECT * FROM sessions WHERE hash=?",
          )
          .get(digest(t))
      : null;
    if (
      !session ||
      session.expires < Date.now() ||
      session.version !== sessionVersion
    )
      return c.json({ error: "Sign in required" }, 401);
    if (!["GET", "HEAD"].includes(c.req.method))
      requireOrigin(c.req.raw, s.config.origin);
    refreshPeriods(s);
    await next();
  });
  app.get("/api/session", (c) => c.json({ username: s.config.admin.username }));
  app.post("/api/logout", (c) => {
    s.db
      .query("DELETE FROM sessions WHERE hash=?")
      .run(digest(getCookie(c, "jetyet") || ""));
    deleteCookie(c, "jetyet", { path: "/" });
    return c.json({ ok: true });
  });
  const view = (e: Entity) => {
    if (!["host", "user"].includes(e.kind)) return { ...e };
    const stale = (last: number | undefined, created: number) =>
      Date.now() - (last || created) > 180000;
    const usageStale =
      e.kind === "host"
        ? stale(e.lastSeen, e.created)
        : s
            .list("node")
            .filter(
              (n) =>
                e.nodeIds.includes(n.id) &&
                n.enabled &&
                n.status === "ready" &&
                !n.deleting,
            )
            .some((n) => stale(n.trafficSeen, n.created));
    if (!e.deleted && !e.deleting) {
      if (usageStale)
        s.alert(
          e.id,
          "stale",
          "Traffic observations are stale; authentication uses last known usage.",
        );
      else s.resolveAlert(e.id, "stale");
    }
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
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function requireOrigin(req: Request, origin: string) {
  if (req.headers.get("origin") !== new URL(origin).origin)
    throw new HttpError(403, "Request origin mismatch");
}
