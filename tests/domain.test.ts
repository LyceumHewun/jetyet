import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addObservation,
  counted,
  exhausted,
  nextReset,
  refreshPeriods,
  resetUsage,
  retention,
  sample,
  usage,
} from "../src/server/accounting";
import { createApp } from "../src/server/api";
import type { Config } from "../src/server/config";
import {
  deploymentScript,
  detectionScript,
  removeScript,
  serverConfig,
} from "../src/server/deployment";
import { digest, token, vault } from "../src/server/crypto";
import { storage, strip, type Store } from "../src/server/db";
import { claim, enqueue, finish } from "../src/server/tasks";
import { defaultTemplate, render } from "../src/server/templates";
import { runOperation } from "../src/workers/operations";

let s: Store, dir: string;
const now = Date.parse("2026-01-15T04:00:00Z");
const quota = {
  limit: 1000,
  direction: "both",
  reset: { kind: "monthly", day: 1, hour: 0 },
};
beforeEach(() => {
  setSystemTime(now);
  dir = mkdtempSync(join(tmpdir(), "jetyet-ci-"));
  s = storage({
    database: join(dir, "db.sqlite"),
    masterKey: "ab".repeat(32),
    origin: "https://network.example.com",
    listen: "127.0.0.1",
    port: 3000,
    admin: {
      username: "admin",
      passwordHash: Bun.password.hashSync("correct-password"),
    },
    probeUrl: "https://example.com",
    hysteriaBinary: "hysteria",
    mihomoBinary: "mihomo",
  } as Config);
});
afterEach(() => {
  s.db.close();
  setSystemTime();
  rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const host = s.put("host", {
    name: "Host",
    enabled: true,
    quota,
    fingerprint: "trusted",
  });
  const node = s.put(
    "node",
    {
      name: "Node",
      hostId: host.id,
      enabled: true,
      status: "ready",
      port: 443,
      address: "203.0.113.1",
      hopping: "",
    },
    { authSecret: token(), statsSecret: token(), probeToken: token() },
  );
  const template = s.put("template", {
    name: "Default",
    published: true,
    body: defaultTemplate,
  });
  const user = s.put(
    "user",
    {
      name: "Friend",
      enabled: true,
      quota,
      nodeIds: [node.id],
      templateIds: [template.id],
      defaultTemplate: template.id,
      expires: null,
    },
    { vpnToken: token(), subscriptionToken: token() },
  );
  usage(s, host);
  usage(s, user);
  return { host, node, user, template };
}
describe("reset schedules", () => {
  test("clamps February without drifting from the configured monthly day", () => {
    const p = { kind: "monthly" as const, day: 31, hour: 0 };
    expect(
      new Date(nextReset(p, Date.parse("2026-02-01T00:00:00Z"))).toISOString(),
    ).toBe("2026-02-27T16:00:00.000Z");
    expect(
      new Date(nextReset(p, Date.parse("2026-03-01T00:00:00Z"))).toISOString(),
    ).toBe("2026-03-30T16:00:00.000Z");
  });
  test("interval anchors survive missed periods", () => {
    const p = {
      kind: "interval" as const,
      days: 30,
      anchor: "2026-01-01T00:00:00Z",
    };
    expect(nextReset(p, Date.parse("2026-03-10T00:00:00Z"))).toBe(
      Date.parse("2026-04-01T00:00:00Z"),
    );
  });
  test("manual reset retains next scheduled boundary and history", () => {
    const { user } = fixture();
    const before = usage(s, user);
    s.db.query("UPDATE usage SET inbound=200 WHERE id=?").run(user.id);
    resetUsage(s, user, true);
    expect(usage(s, user).inbound).toBe(0);
    expect(usage(s, user).next).toBe(before.next);
    expect(
      s.db
        .query("SELECT id FROM events WHERE type=?")
        .all("traffic.manual-reset"),
    ).toHaveLength(1);
  });
  test("recovery uses the latest scheduled period rather than recovery time", () => {
    const { user } = fixture();
    setSystemTime(Date.parse("2026-04-12T00:00:00Z"));
    refreshPeriods(s);
    expect(usage(s, user).start).toBe(Date.parse("2026-03-31T16:00:00Z"));
    expect(usage(s, user).next).toBe(Date.parse("2026-04-30T16:00:00Z"));
  });
});
describe("traffic integrity", () => {
  test("repeated observations do not double count and first user traffic is retained", () => {
    const { user } = fixture();
    s.db.transaction(() =>
      addObservation(s, user, "node:n:user:u", "epoch", 100, 200),
    )();
    expect(usage(s, user).inbound).toBe(100);
    s.db.transaction(() =>
      addObservation(s, user, "node:n:user:u", "epoch", 100, 200),
    )();
    expect(usage(s, user).outbound).toBe(200);
    addObservation(s, user, "node:n:user:u", "epoch", 200, 300);
    expect(usage(s, user).inbound).toBe(200);
  });
  test("host initial usage is not duplicated by existing host counters", () => {
    const host = s.put("host", { quota, initialIn: 50, initialOut: 100 });
    addObservation(s, host, "host:h", "boot", 1000000, 2000000);
    expect(usage(s, host).inbound).toBe(50);
    addObservation(s, host, "host:h", "boot", 1000010, 2000020);
    expect(usage(s, host).outbound).toBe(120);
  });
  test("counter rollback records a gap without inventing negative usage", () => {
    const { user } = fixture();
    addObservation(s, user, "node:n:user:u", "epoch", 100, 200);
    addObservation(s, user, "node:n:user:u", "epoch2", 5, 8);
    expect(usage(s, user).inbound).toBe(100);
    expect(
      s.db.query("SELECT id FROM events WHERE type=?").all("traffic.gap"),
    ).toHaveLength(1);
  });
  test("direction changes reevaluate quota from independent totals", () => {
    const { user } = fixture();
    s.db
      .query("UPDATE usage SET inbound=600,outbound=500 WHERE id=?")
      .run(user.id);
    expect(exhausted(s, user)).toBe(true);
    expect(
      exhausted(s, { ...user, quota: { ...quota, direction: "out" } }),
    ).toBe(false);
    expect(
      counted({ ...quota, direction: "both" } as any, usage(s, user)),
    ).toBe(1100);
  });
  test("retention preserves traffic totals and actual observation counts", () => {
    const { host } = fixture();
    const at = now - 40 * 86400000;
    sample(s, host.id, at, 10, 20, {
      reachable: 1,
      cpu: 40,
      memory: 50,
      disk: 60,
    });
    sample(s, host.id, at + 60000, 30, 40, { reachable: 0 });
    retention(s);
    const row = s.db
      .query<any, [string]>(
        "SELECT SUM(inbound) inbound,SUM(outbound) outbound,SUM(observations) observations,SUM(successes) successes,MAX(cpu_max) cpu FROM samples WHERE entity=?",
      )
      .get(host.id);
    expect(row).toEqual({
      inbound: 40,
      outbound: 60,
      observations: 2,
      successes: 1,
      cpu: 40,
    });
  });
  test("manual reset preserves counter timestamps and flags nonzero crossings within 120s while staying quiet on zero traffic", () => {
    const { user } = fixture();
    addObservation(s, user, "node:n:user:u", "epoch", 100, 200, now);
    setSystemTime(now + 30000);
    resetUsage(s, user, true);
    const counter = s.db
      .query<{ at: number }, [string]>("SELECT at FROM counters WHERE source=?")
      .get("node:n:user:u");
    expect(counter?.at).toBe(now);
    addObservation(s, user, "node:n:user:u", "epoch", 100, 200, now + 60000);
    expect(usage(s, user).inbound).toBe(0);
    expect(
      s.db.query("SELECT id FROM events WHERE type=?").all("traffic.gap"),
    ).toHaveLength(0);
    setSystemTime(now + 90000);
    resetUsage(s, user, true);
    addObservation(s, user, "node:n:user:u", "epoch", 150, 260, now + 100000);
    expect(usage(s, user).inbound).toBe(0);
    expect(usage(s, user).outbound).toBe(0);
    expect(
      s.db.query("SELECT id FROM events WHERE type=?").all("traffic.gap"),
    ).toHaveLength(1);
    addObservation(s, user, "node:n:user:u", "epoch", 190, 310, now + 160000);
    expect(usage(s, user).inbound).toBe(40);
    expect(usage(s, user).outbound).toBe(50);
  });
  test("delayed observations do not credit new periods or regress counter baselines", () => {
    const { user } = fixture();
    addObservation(s, user, "node:n:user:u", "epoch", 100, 200, now);
    setSystemTime(now + 60000);
    resetUsage(s, user, true);
    addObservation(s, user, "node:n:user:u", "epoch", 100, 200, now + 30000);
    expect(usage(s, user).inbound).toBe(0);
    expect(
      s.db.query("SELECT id FROM events WHERE type=?").all("traffic.gap"),
    ).toHaveLength(0);
    addObservation(s, user, "node:n:user:u", "epoch", 120, 230, now + 120000);
    expect(usage(s, user).inbound).toBe(0);
    expect(
      s.db.query("SELECT id FROM events WHERE type=?").all("traffic.gap"),
    ).toHaveLength(1);
    addObservation(s, user, "node:n:user:u", "epoch", 110, 210, now + 90000);
    const counter = s.db
      .query<{ at: number; inbound: number }, [string]>(
        "SELECT at,inbound FROM counters WHERE source=?",
      )
      .get("node:n:user:u");
    expect(counter).toEqual({ at: now + 120000, inbound: 120 });
    addObservation(s, user, "node:n:user:u", "epoch", 150, 270, now + 180000);
    expect(usage(s, user).inbound).toBe(30);
    expect(usage(s, user).outbound).toBe(40);
  });
  test("first auth after reset establishes baseline while pre-reset auth plus post-reset reconnect flags gap", async () => {
    const { node, user } = fixture();
    const app = createApp(s);
    const user2 = s.put(
      "user",
      {
        name: "Friend2",
        enabled: true,
        quota,
        nodeIds: [node.id],
        templateIds: user.templateIds,
        defaultTemplate: user.defaultTemplate,
        expires: null,
      },
      { vpnToken: token(), subscriptionToken: token() },
    );
    usage(s, user2);
    const authReq = (tok: string) =>
      app.request(
        `/auth/hysteria/${node.id}/${s.secrets(node.id).authSecret}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auth: tok }),
        },
      );
    expect(await (await authReq(s.secrets(user.id).vpnToken)).json()).toEqual({
      ok: true,
      id: user.id,
    });
    setSystemTime(now + 10000);
    resetUsage(s, user, true);
    resetUsage(s, user2, true);
    setSystemTime(now + 20000);
    expect(await (await authReq(s.secrets(user.id).vpnToken)).json()).toEqual({
      ok: true,
      id: user.id,
    });
    expect(await (await authReq(s.secrets(user2.id).vpnToken)).json()).toEqual({
      ok: true,
      id: user2.id,
    });
    addObservation(
      s,
      user,
      `node:${node.id}:user:${user.id}`,
      "epoch",
      500,
      600,
      now + 30000,
    );
    expect(usage(s, user).inbound).toBe(0);
    expect(usage(s, user).outbound).toBe(0);
    expect(
      s.db
        .query("SELECT id FROM events WHERE entity=? AND type=?")
        .all(user.id, "traffic.gap"),
    ).toHaveLength(1);
    addObservation(
      s,
      user2,
      `node:${node.id}:user:${user2.id}`,
      "epoch",
      500,
      600,
      now + 30000,
    );
    expect(usage(s, user2).inbound).toBe(500);
    expect(usage(s, user2).outbound).toBe(600);
  });
});
describe("authorization and templates", () => {
  test("HTTP auth isolates nodes and enforces user and host allowances without sessions", async () => {
    const { host, node, user } = fixture(),
      app = createApp(s);
    const request = () =>
      app.request(
        `/auth/hysteria/${node.id}/${s.secrets(node.id).authSecret}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auth: s.secrets(user.id).vpnToken }),
        },
      );
    expect(await (await request()).json()).toEqual({ ok: true, id: user.id });
    s.db.query("UPDATE usage SET inbound=1000 WHERE id=?").run(host.id);
    expect(await (await request()).json()).toEqual({ ok: false });
  });
  test("user token alone cannot identify a node and draft nodes cannot authorize", async () => {
    const { node, user } = fixture(),
      app = createApp(s);
    const r = await app.request(`/auth/hysteria/${node.id}/wrong`, {
      method: "POST",
      body: JSON.stringify({ auth: s.secrets(user.id).vpnToken }),
    });
    expect(r.status).toBe(403);
    s.put("node", { ...node, status: "draft" }, undefined, node.id);
    const denied = await app.request(
      `/auth/hysteria/${node.id}/${s.secrets(node.id).authSecret}`,
      {
        method: "POST",
        body: JSON.stringify({ auth: s.secrets(user.id).vpnToken }),
      },
    );
    expect(await denied.json()).toEqual({ ok: false });
  });
  test("subscription downloads without a mihomo binary", async () => {
    const { user } = fixture();
    s.config.mihomoBinary = join(dir, "missing-mihomo");
    const app = createApp(s);
    const response = await app.request(
      `/sub/${s.secrets(user.id).subscriptionToken}`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("203.0.113.1");
  });
  test("revoked nodes disappear immediately without stale fallback", () => {
    const { node, user } = fixture();
    const before = render(s, user, defaultTemplate);
    expect(before).toContain("203.0.113.1");
    s.put("node", { ...node, enabled: false }, undefined, node.id);
    expect(render(s, user, defaultTemplate)).not.toContain("203.0.113.1");
  });
  test("preview redacts tokens and file tags cannot bypass the sandbox", () => {
    const { user } = fixture();
    expect(render(s, user, defaultTemplate, "admin-preview")).toContain(
      "REDACTED",
    );
    expect(render(s, user, defaultTemplate, "admin-preview")).not.toContain(
      s.secrets(user.id).vpnToken,
    );
    expect(() => render(s, user, "{%- include 'package.json' -%}")).toThrow();
  });
  test("admin endpoints reject unauthenticated requests and mutations with wrong origin", async () => {
    const app = createApp(s);
    expect((await app.request("/api/state")).status).toBe(401);
    expect(
      (
        await app.request("/api/login", {
          method: "POST",
          headers: { origin: "https://evil.example" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
  });
  test("portal password links rotate, expire, and invalidate old sessions only after use", async () => {
    const { user } = fixture();
    s.put("user", { ...strip(user), username: "friend" }, undefined, user.id);
    const app = createApp(s);
    const post = (path: string, body: unknown, cookie = "") =>
      app.request(path, {
        method: "POST",
        headers: { origin: s.config.origin, cookie },
        body: JSON.stringify(body),
      });
    const admin = await post("/api/login", {
      username: "ADMIN",
      password: "correct-password",
    });
    expect(admin.status).toBe(200);
    const adminCookie = admin.headers.get("set-cookie")!.split(";")[0];
    const issue = async () => {
      const response = await post(
        `/api/users/${user.id}/password-link`,
        {},
        adminCookie,
      );
      expect(response.status).toBe(200);
      const { url, expires } = await response.json();
      return { token: new URL(url).hash.slice(1), expires };
    };
    const eventData = (type: string) =>
      s.db
        .query<{ data: string }, [string, string]>(
          "SELECT data FROM events WHERE entity=? AND type=? ORDER BY rowid",
        )
        .all(user.id, type)
        .map(({ data }) => JSON.parse(data));
    const first = await issue();
    const second = await issue();
    const revoked = first.token;
    const active = second.token;
    expect(eventData("portal.password-link.issued")).toEqual(
      [first, second].map(({ expires }, index) => ({
        actor: s.config.admin.username,
        username: "friend",
        expires,
        replacedLink: index === 1,
      })),
    );
    const path = "/api/portal-password";
    const malformed = await post(path, { token: "short" });
    expect(malformed.status).toBe(403);
    expect(await malformed.json()).toEqual({
      error: "This password link is invalid or expired",
    });
    expect((await post(path, { token: revoked })).status).toBe(403);
    expect((await post(path, { token: active })).status).toBe(200);
    const initial = await post(path, {
      token: active,
      password: "first-portal-password",
    });
    expect(initial.status).toBe(200);
    expect((await post(path, { token: active })).status).toBe(403);
    const oldCookie = initial.headers.get("set-cookie")!.split(";")[0];
    const portal = (cookie: string) =>
      app.request("/api/portal", { headers: { cookie } });
    expect((await portal(oldCookie)).status).toBe(200);
    expect(
      (await app.request("/api/state", { headers: { cookie: oldCookie } }))
        .status,
    ).toBe(401);
    const { token: expiring } = await issue();
    setSystemTime(now + 86400000);
    expect((await post(path, { token: expiring })).status).toBe(403);
    const { token: reset } = await issue();
    expect((await portal(oldCookie)).status).toBe(200);
    const changed = await post(path, {
      token: reset,
      password: "second-portal-password",
    });
    expect(changed.status).toBe(200);
    expect(eventData("portal.password.changed")).toEqual([
      { username: "friend", replacedPassword: false },
      { username: "friend", replacedPassword: true },
    ]);
    expect((await portal(oldCookie)).status).toBe(401);
    expect(
      (
        await post("/api/login", {
          username: "friend",
          password: "first-portal-password",
        })
      ).status,
    ).toBe(401);
    const newCookie = changed.headers.get("set-cookie")!.split(";")[0];
    s.put(
      "user",
      {
        ...strip(user),
        username: "friend",
        expires: new Date(now).toISOString(),
      },
      undefined,
      user.id,
    );
    expect(await (await portal(newCookie)).json()).toMatchObject({
      expired: true,
      defaultLink: null,
    });
    s.put(
      "user",
      { ...strip(user), username: "friend", enabled: false },
      undefined,
      user.id,
    );
    expect((await portal(newCookie)).status).toBe(401);
  });
  test("personal template publication is owner-scoped and previews hide live node details", async () => {
    const { node, user, template } = fixture();
    const app = createApp(s);
    const another = s.put(
      "user",
      { ...strip(user), name: "Other" },
      {
        vpnToken: token(),
        subscriptionToken: token(),
      },
    );
    s.put("user", { ...strip(user), username: "friend" }, undefined, user.id);
    const secret = token();
    s.db
      .query("INSERT INTO portal_sessions VALUES(?,?,?)")
      .run(digest(secret), user.id, now + 60000);
    const request = (path: string, method = "GET", body?: unknown) =>
      app.request(path, {
        method,
        headers: { origin: s.config.origin, cookie: `jetyet=${secret}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const overview = await request("/api/portal");
    expect(await overview.json()).toMatchObject({
      defaultLink: `${s.config.origin}/sub/${s.secrets(user.id).subscriptionToken}`,
    });
    s.put("node", { ...strip(node), name: "rule" }, undefined, node.id);
    const literalBody = defaultTemplate
      .replace("{{ choices | yaml | indent: 6 }}", "      - rule")
      .replace(
        "  - MATCH,Proxy",
        "  - SUB-RULE,(NETWORK,TCP),rule\n  - MATCH,rule",
      )
      .concat("sub-rules:\n  rule:\n    - MATCH,Proxy\n");
    s.put(
      "template",
      { ...strip(template), body: literalBody },
      undefined,
      template.id,
    );
    const assigned = await request(
      `/api/portal/templates/${template.id}/preview`,
      "POST",
    );
    expect(assigned.status).toBe(200);
    const assignedText = (await assigned.json()).text;
    expect(assignedText).toContain("MATCH,Preview node 1");
    expect(assignedText).toContain("mode: rule");
    expect(assignedText).toContain("SUB-RULE,(NETWORK,TCP),rule");
    expect(assignedText).not.toContain("name: rule");
    s.put("template", strip(template), undefined, template.id);
    const created = await request("/api/portal/templates", "POST", {
      sourceId: template.id,
      name: "Personal",
    });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const root = `/api/portal/templates/${id}`;
    const subscription = (u: typeof user, templateQuery = `?template=${id}`) =>
      app.request(`/sub/${s.secrets(u.id).subscriptionToken}${templateQuery}`);
    expect((await request(root + "/publish", "POST")).status).toBe(409);
    expect((await subscription(user)).status).toBe(403);
    const preview = await request(root + "/preview", "POST");
    expect(preview.status).toBe(200);
    const { text } = await preview.json();
    expect(text).toContain("Preview node 1");
    expect(text).not.toContain("203.0.113.1");
    expect(text).not.toContain(s.secrets(user.id).vpnToken);
    expect((await request(root + "/publish", "POST")).status).toBe(200);
    expect(await (await subscription(user)).text()).toContain("203.0.113.1");
    expect((await subscription(another)).status).toBe(403);
    expect(
      (
        await request(root, "PUT", {
          name: "Bad rule",
          body: defaultTemplate.replace("MATCH,Proxy", "MATCH,Missing policy"),
        })
      ).status,
    ).toBe(200);
    expect((await request(root + "/preview", "POST")).status).toBe(422);
    expect(
      (await request(root, "PUT", { name: "Broken", body: "dns:" })).status,
    ).toBe(200);
    expect((await request(root + "/preview", "POST")).status).toBe(422);
    expect((await subscription(user)).status).toBe(200);
    expect((await subscription(user, "")).status).toBe(200);
    const simulatedBody = `{% if nodes[0].server != 'node-1.invalid' %}invalid{% else %}${defaultTemplate}
proxy-providers:
  example:
    type: http
    url: socks5://proxy-user:proxy-password@provider.invalid/list?%61pi_key=secret-query-value&accessToken=secret-query-value&source=fixture
    header:
      X-Api-Key: [secret-header-value]
{% endif %}`;
    expect(
      (await request(root, "PUT", { name: "Simulation", body: simulatedBody }))
        .status,
    ).toBe(200);
    const simulated = await request(root + "/preview", "POST");
    expect(simulated.status).toBe(200);
    const simulatedText = (await simulated.json()).text;
    expect(simulatedText).toContain("node-1.invalid");
    expect(simulatedText).not.toContain("203.0.113.1");
    expect(simulatedText).not.toContain("proxy-password");
    expect(simulatedText).not.toContain("secret-header-value");
    expect(simulatedText).not.toContain("secret-query-value");
    expect(simulatedText).toContain("source=fixture");
  });
});
describe("queue and encryption", () => {
  test("generated native deployment scripts are valid Bash for IP and port-hopping configurations", () => {
    const { node } = fixture();
    for (const script of [
      deploymentScript(s, node, "v2.13.0"),
      deploymentScript(
        s,
        { ...node, address: "2001:db8::1", hopping: "20000-50000" },
        "v2.13.0",
        true,
      ),
      detectionScript,
      removeScript(node.id),
    ]) {
      const result = Bun.spawnSync(["bash", "-n"], {
        stdin: Buffer.from(script),
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode).toBe(0);
    }
  });
  test("SQLite prevents duplicate nodes on one host even outside the HTTP layer", () => {
    const { host } = fixture();
    expect(() =>
      s.put("node", { hostId: host.id, name: "Duplicate" }),
    ).toThrow();
  });
  test("one host serializes remote mutations while urgent kicks bypass deployments", () => {
    const h = crypto.randomUUID();
    enqueue(s, h, "deploy");
    enqueue(s, h, "upgrade");
    enqueue(s, h, "kick", { userIds: ["u"] });
    expect(claim(s, false, "operations")?.kind).toBe("deploy");
    expect(claim(s, false, "operations")).toBeNull();
    expect(claim(s, true, "monitor")?.kind).toBe("kick");
  });
  test("expired leases are reclaimable, live leases are not", () => {
    enqueue(s, "h", "deploy");
    const first = claim(s, false, "old")!;
    expect(claim(s, false, "new")).toBeNull();
    setSystemTime(now + 100000);
    const next = claim(s, false, "new")!;
    expect(next.id).toBe(first.id);
    expect(next.owner).toBe("new");
  });
  test("encrypted credentials reject tampering and wrong keys", () => {
    const a = vault("aa".repeat(32)),
      b = vault("bb".repeat(32));
    const sealed = a.seal("secret");
    expect(sealed).not.toContain("secret");
    expect(a.open(sealed)).toBe("secret");
    expect(() => b.open(sealed)).toThrow();
    const bytes = Buffer.from(sealed, "base64");
    bytes[bytes.length - 1] ^= 1;
    expect(() => a.open(bytes.toString("base64"))).toThrow();
  });
});
describe("detect operation and concurrent safety", () => {
  test("manual install is retryable for 15 minutes and publishes BBR only after detection", async () => {
    const { host, node, user } = fixture();
    const app = createApp(s);
    const post = (path: string, body: unknown, cookie = "") =>
      app.request(path, {
        method: "POST",
        headers: { origin: s.config.origin, cookie },
        body: JSON.stringify(body),
      });
    const login = await post("/api/login", {
      username: "ADMIN",
      password: "correct-password",
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const options = {
      protocol: "hysteria2",
      congestion: "bbr",
      tuning: true,
    } as const;
    const version = "v2.13.0";
    const route = `/api/nodes/${node.id}/command`;
    expect((await post(route, { version, ...options })).status).toBe(401);
    expect(
      (await post(route, { version: "v2.7.1", ...options }, cookie)).status,
    ).toBe(400);
    const issued = await post(route, { version, ...options }, cookie);
    expect(issued.status).toBe(200);
    const { command, expiresAt } = await issued.json();
    expect(expiresAt).toBe(new Date(now + 900000).toISOString());
    const path = new URL(command.match(/https:\/\/[^']+/)[0]).pathname;
    const download = await app.request(path);
    expect(download.headers.get("cache-control")).toBe("no-store");
    const script = await download.text();
    expect(script).toContain("Adaptive tuning:");
    expect(script).toContain(version);
    expect(await (await app.request(path)).text()).toBe(script);
    expect(render(s, user, defaultTemplate)).toContain("up: 1000");
    setSystemTime(now + 900000);
    expect((await app.request(path)).status).toBe(404);

    const hash = digest(serverConfig(s, node, options));
    enqueue(s, host.id, "detect", { nodeId: node.id });
    const task = claim(s, false, "ops")!;
    await runOperation(s, task, async () =>
      JSON.stringify({
        ...options,
        owner: "jetyet",
        phase: "ready",
        version,
        actualVersion: version,
        nodeId: node.id,
        hostId: host.id,
        address: node.address,
        port: node.port,
        hopping: node.hopping,
        configHash: hash,
        actualHash: hash,
        active: true,
      }),
    );
    expect(s.get(node.id)?.congestion).toBe("bbr");
    expect(render(s, user, defaultTemplate)).not.toContain("up: 1000");
    expect(render(s, user, defaultTemplate)).not.toContain("down: 1000");
  });

  test("detect keeps disabled nodes stopped and re-verifies active state when starting", async () => {
    const { host, node } = fixture();
    const actualHash = digest(serverConfig(s, node));
    const manifest = (active: boolean) =>
      JSON.stringify({
        owner: "jetyet",
        phase: "ready",
        version: "v2.6.5",
        actualVersion: "v2.6.5",
        nodeId: node.id,
        hostId: host.id,
        address: node.address,
        protocol: "hysteria2",
        congestion: "brutal",
        tuning: false,
        configHash: actualHash,
        actualHash,
        hopping: "20000-50000",
        port: node.port,
        active,
      });
    s.put(
      "node",
      {
        ...strip(node),
        status: "draft",
        enabled: false,
        hopping: "20000-50000",
      },
      undefined,
      node.id,
    );
    const disabledId = enqueue(s, host.id, "detect", { nodeId: node.id });
    const disabledTask = claim(s, false, "ops")!;
    expect(disabledTask.id).toBe(disabledId);
    const calls: string[] = [];
    await runOperation(s, disabledTask, async (script) => {
      calls.push(script);
      return manifest(false);
    });
    finish(s, disabledTask, "succeeded");
    expect(calls).toHaveLength(1);
    expect(s.get(node.id)?.status).toBe("ready");
    expect(s.get(node.id)?.enabled).toBe(false);

    s.put(
      "node",
      { ...strip(s.get(node.id)!), status: "draft", enabled: true },
      undefined,
      node.id,
    );
    enqueue(s, host.id, "detect", { nodeId: node.id });
    const failTask = claim(s, false, "ops")!;
    await expect(
      runOperation(s, failTask, async (script) => {
        if (script.includes("systemctl start")) return "";
        return manifest(false);
      }),
    ).rejects.toThrow("failed to start");
    finish(s, failTask, "failed");
    expect(s.get(node.id)?.status).toBe("draft");

    enqueue(s, host.id, "detect", { nodeId: node.id });
    const okTask = claim(s, false, "ops")!;
    let detects = 0;
    await runOperation(s, okTask, async (script) => {
      if (script.includes("systemctl start")) return "";
      detects++;
      return manifest(detects > 1);
    });
    finish(s, okTask, "succeeded");
    expect(detects).toBe(2);
    expect(s.get(node.id)?.status).toBe("ready");
  });
  test("detect preserves concurrent toggle for state convergence and rejects config edits or deletion", async () => {
    const { host, node } = fixture();
    const actualHash = digest(serverConfig(s, node));
    const manifest = (active: boolean) =>
      JSON.stringify({
        owner: "jetyet",
        phase: "ready",
        version: "v2.6.5",
        actualVersion: "v2.6.5",
        nodeId: node.id,
        hostId: host.id,
        address: node.address,
        protocol: "hysteria2",
        congestion: "brutal",
        tuning: false,
        configHash: actualHash,
        actualHash,
        hopping: "",
        port: node.port,
        active,
      });

    // 1. Concurrent enabled toggle during remote start + queued node-state convergence
    s.put(
      "node",
      { ...strip(node), status: "draft", enabled: true },
      undefined,
      node.id,
    );
    enqueue(s, host.id, "detect", { nodeId: node.id });
    const t1 = claim(s, false, "ops")!;
    let detects = 0;
    const cmds: string[] = [];
    await runOperation(s, t1, async (script) => {
      cmds.push(script);
      if (script.includes("systemctl start")) {
        s.put(
          "node",
          { ...strip(s.get(node.id)!), enabled: false },
          undefined,
          node.id,
        );
        enqueue(s, host.id, "node-state", { nodeId: node.id });
        return "";
      }
      if (script.includes("systemctl stop")) return "";
      detects++;
      return manifest(detects > 1);
    });
    finish(s, t1, "succeeded");
    expect(s.get(node.id)?.status).toBe("ready");
    expect(s.get(node.id)?.enabled).toBe(false);
    expect(cmds.some((c) => c.includes("systemctl stop"))).toBe(true);

    const stateTask = claim(s, false, "ops")!;
    expect(stateTask.kind).toBe("node-state");
    const stateCmds: string[] = [];
    await runOperation(s, stateTask, async (script) => {
      stateCmds.push(script);
      return "";
    });
    finish(s, stateTask, "succeeded");
    expect(stateCmds.some((c) => c.includes("systemctl stop"))).toBe(true);

    // 2. Concurrent desired config edit during remote start rejects stale ready writeback
    s.put(
      "node",
      { ...strip(s.get(node.id)!), status: "draft", enabled: true, port: 443 },
      undefined,
      node.id,
    );
    enqueue(s, host.id, "detect", { nodeId: node.id });
    const t2 = claim(s, false, "ops")!;
    let d2 = 0;
    await expect(
      runOperation(s, t2, async (script) => {
        if (script.includes("systemctl start")) {
          s.put(
            "node",
            { ...strip(s.get(node.id)!), port: 8443 },
            undefined,
            node.id,
          );
          return "";
        }
        d2++;
        return manifest(d2 > 1);
      }),
    ).rejects.toThrow("changed during detection");
    finish(s, t2, "failed");
    expect(s.get(node.id)?.status).toBe("draft");
    expect(s.get(node.id)?.port).toBe(8443);

    // 3. Concurrent mark-for-delete during remote start rejects stale writeback
    s.put(
      "node",
      { ...strip(s.get(node.id)!), status: "draft", enabled: true, port: 443 },
      undefined,
      node.id,
    );
    enqueue(s, host.id, "detect", { nodeId: node.id });
    const t3 = claim(s, false, "ops")!;
    let d3 = 0;
    await expect(
      runOperation(s, t3, async (script) => {
        if (script.includes("systemctl start")) {
          s.put(
            "node",
            { ...strip(s.get(node.id)!), deleting: true, enabled: false },
            undefined,
            node.id,
          );
          return "";
        }
        d3++;
        return manifest(d3 > 1);
      }),
    ).rejects.toThrow("Entity removed during detection");
    finish(s, t3, "failed");
    expect(s.get(node.id)?.deleting).toBe(true);
    expect(s.get(node.id)?.status).toBe("draft");
  });
});
