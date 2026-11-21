import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { digest, same, token } from "./crypto";
import type { Store } from "./db";
import { HttpError, requireOrigin } from "./errors";
import { portalOverview } from "./routes/portal";

const day = 86400000;
const sessionDays = 7;
const invalidLink = () =>
  new HttpError(403, "This password link is invalid or expired");

export function issuePasswordLink(s: Store, user: string) {
  const secret = token();
  const expires = Date.now() + day;
  s.db
    .query(
      "INSERT INTO portal_password_links VALUES(?,?,?) ON CONFLICT(user) DO UPDATE SET hash=excluded.hash,expires=excluded.expires",
    )
    .run(user, digest(secret), expires);
  return { url: `${s.config.origin}/set-password#${secret}`, expires };
}

export function revokePortalAccess(s: Store, user: string) {
  s.db.query("DELETE FROM portal_sessions WHERE user=?").run(user);
  s.db.query("DELETE FROM portal_password_links WHERE user=?").run(user);
}

export function registerSignIn(app: Hono, s: Store) {
  const admin = s.config.admin.username;
  const adminName = admin.toLowerCase();
  const adminHash = s.config.admin.passwordHash!;
  const version = digest(admin + ":" + adminHash);
  if (s.userByUsername(adminName))
    throw Error("Administrator username conflicts with a subscription user");
  const cookieHash = (c: Context) => digest(getCookie(c, "jetyet") || "");
  const availableUser = (id: string) => {
    const u = s.get(id);
    return u?.kind === "user" && !u.deleted && u.enabled && u.username
      ? u
      : null;
  };
  const passwordHash = (id: string) =>
    s.db
      .query<{ hash: string }, [string]>(
        "SELECT hash FROM portal_passwords WHERE user=?",
      )
      .get(id)?.hash;
  const sessionUser = (c: Context) => {
    const row = s.db
      .query<{ user: string }, [string, number]>(
        "SELECT user FROM portal_sessions WHERE hash=? AND expires>?",
      )
      .get(cookieHash(c), Date.now());
    return row ? availableUser(row.user) : null;
  };
  const isAdmin = (c: Context) =>
    !!s.db
      .query("SELECT 1 FROM sessions WHERE hash=? AND version=? AND expires>?")
      .get(cookieHash(c), version, Date.now());
  function clearSession(c: Context) {
    const hash = cookieHash(c);
    s.db.query("DELETE FROM sessions WHERE hash=?").run(hash);
    s.db.query("DELETE FROM portal_sessions WHERE hash=?").run(hash);
  }
  function signIn(c: Context, user?: string) {
    const secret = token();
    const expires = Date.now() + sessionDays * day;
    clearSession(c);
    if (user)
      s.db
        .query("INSERT INTO portal_sessions VALUES(?,?,?)")
        .run(digest(secret), user, expires);
    else
      s.db
        .query("INSERT INTO sessions VALUES(?,?,?)")
        .run(digest(secret), version, expires);
    setCookie(c, "jetyet", secret, {
      httpOnly: true,
      secure: new URL(s.config.origin).protocol === "https:",
      sameSite: "Strict",
      path: "/",
      maxAge: sessionDays * 86400,
    });
  }

  app.post("/api/login", async (c) => {
    requireOrigin(c.req.raw, s.config.origin);
    const behindProxy = ["127.0.0.1", "::1", "localhost"].includes(
      s.config.listen,
    );
    const key = digest(
      behindProxy ? c.req.header("x-real-ip") || "local" : "direct",
    );
    const globalKey = digest("__global__");
    const now = Date.now();
    const attempts = (k: string) =>
      s.db
        .query<{ attempts: number }, [string, number]>(
          "SELECT attempts FROM login_limits WHERE key=? AND reset>?",
        )
        .get(k, now)?.attempts ?? 0;
    if (attempts(key) >= 10 || attempts(globalKey) >= 50)
      return c.json({ error: "Too many attempts. Retry in 15 minutes." }, 429);
    const { username, password } = z
      .object({
        username: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .transform((name) => name.toLowerCase()),
        password: z.string().min(1).max(1000),
      })
      .parse(await c.req.json());
    const bump = (k: string) =>
      s.db
        .query(
          "INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset<=? THEN 1 ELSE attempts+1 END,reset=CASE WHEN reset<=? THEN excluded.reset ELSE reset END",
        )
        .run(k, now + 900000, now, now);
    bump(key);
    const forAdmin = same(username, adminName);
    const user = forAdmin ? null : s.userByUsername(username);
    const hash = user?.enabled ? passwordHash(user.id) : undefined;
    const valid = await Bun.password.verify(password, hash ?? adminHash);
    if (valid && forAdmin) {
      signIn(c);
      s.db.query("DELETE FROM login_limits WHERE key=?").run(key);
      return c.json({ username: admin, role: "admin" });
    }
    if (
      valid &&
      user &&
      hash &&
      availableUser(user.id)?.username === username &&
      passwordHash(user.id) === hash
    ) {
      signIn(c, user.id);
      s.db.query("DELETE FROM login_limits WHERE key=?").run(key);
      return c.json({ username, role: "subscriber" });
    }
    bump(globalKey);
    return c.json({ error: "Invalid username or password" }, 401);
  });

  function passwordLinkUser(linkHash: string) {
    const row = s.db
      .query<{ user: string }, [string, number]>(
        "SELECT user FROM portal_password_links WHERE hash=? AND expires>?",
      )
      .get(linkHash, Date.now());
    const user = row && availableUser(row.user);
    if (!user) throw invalidLink();
    return user;
  }
  app.post("/api/portal-password", async (c) => {
    requireOrigin(c.req.raw, s.config.origin);
    const input = z
      .object({
        token: z.string(),
        password: z.string().min(12).max(1000).optional(),
      })
      .parse(await c.req.json());
    if (!/^[a-zA-Z0-9_-]{43}$/.test(input.token)) throw invalidLink();
    const linkHash = digest(input.token);
    const user = passwordLinkUser(linkHash);
    if (input.password === undefined)
      return c.json({ username: user.username });
    const hash = await Bun.password.hash(input.password, {
      algorithm: "argon2id",
    });
    s.db
      .transaction(() => {
        passwordLinkUser(linkHash);
        s.db
          .query(
            "INSERT INTO portal_passwords VALUES(?,?) ON CONFLICT(user) DO UPDATE SET hash=excluded.hash",
          )
          .run(user.id, hash);
        revokePortalAccess(s, user.id);
        s.event(user.id, "portal.password.changed", {});
        signIn(c, user.id);
      })
      .immediate();
    return c.json({ username: user.username, role: "subscriber" });
  });
  app.get("/api/session", (c) => {
    if (isAdmin(c)) return c.json({ username: admin, role: "admin" });
    const user = sessionUser(c);
    if (!user) return c.json({ error: "Sign in required" }, 401);
    return c.json({
      username: user.username,
      role: "subscriber",
      ...(c.req.query("portal") === "1" && { portal: portalOverview(s, user) }),
    });
  });
  app.post("/api/logout", (c) => {
    requireOrigin(c.req.raw, s.config.origin);
    clearSession(c);
    deleteCookie(c, "jetyet", { path: "/" });
    return c.json({ ok: true });
  });
  return { isAdmin, sessionUser };
}
