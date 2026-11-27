import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import { Database } from "bun:sqlite";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  addObservation,
  counted,
  exhausted,
  nextReset,
  nodeDelta,
  refreshPeriods,
  resetUsage,
  retention,
  sample,
  usage,
} from "../src/server/accounting";
import { createApp } from "../src/server/api";
import type { Config } from "../src/server/config";
import {
  controlledProbeScript,
  deploymentScript,
  detectionScript,
  echKeysParserPy,
  removeScript,
  serverConfig,
} from "../src/server/deployment";
import { digest, token, vault } from "../src/server/crypto";
import { storage, strip, type Store } from "../src/server/db";
import { claim, enqueue, finish } from "../src/server/tasks";
import {
  defaultSingBoxTemplate,
  defaultTemplate,
  render,
} from "../src/server/templates";
import { collectHost } from "../src/workers/monitor";
import { runOperation } from "../src/workers/operations";
import { probeNode } from "../src/workers/probe";

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
    singBoxBinary: "sing-box",
  } as Config);
});
afterEach(() => {
  s.db.close();
  setSystemTime();
  rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  createApp(s);
  const singBox = s.list("template").find((t) => t.format === "sing-box")!;
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
    format: "mihomo",
  });
  const user = s.put(
    "user",
    {
      name: "Friend",
      username: "friend",
      enabled: true,
      quota,
      nodeIds: [node.id],
      templateIds: [template.id, singBox.id],
      defaultTemplates: { mihomo: template.id, "sing-box": singBox.id },
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
        defaultTemplates: user.defaultTemplates,
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
    s.db.query("UPDATE usage SET next=? WHERE id=?").run(now, host.id);
    expect(await (await request()).json()).toEqual({ ok: true, id: user.id });
    expect(usage(s, host).inbound).toBe(0);
  });
  test("VPN auth waits asynchronously to record first use when SQLite is busy", async () => {
    const { node, user } = fixture();
    const app = createApp(s);
    const writer = new Database(s.config.database);
    const request = (signal?: AbortSignal) =>
      app.request(`/auth/hysteria/${node.id}/${s.secrets(node.id).authSecret}`, {
        method: "POST",
        body: JSON.stringify({ auth: s.secrets(user.id).vpnToken }),
        signal,
      });
    try {
      writer.exec("BEGIN IMMEDIATE");
      const controller = new AbortController();
      const cancelled = request(controller.signal);
      await Bun.sleep(30);
      controller.abort();
      expect((await cancelled).status).toBe(499);
      expect(s.db.query("SELECT * FROM first_auth").all()).toHaveLength(0);

      const first = request();
      await Bun.sleep(30);
      expect(s.db.query("SELECT * FROM first_auth").all()).toHaveLength(0);
      writer.exec("ROLLBACK");
      expect(await (await first).json()).toEqual({ ok: true, id: user.id });
      expect(s.db.query("SELECT * FROM first_auth").all()).toHaveLength(1);

      writer.exec("BEGIN IMMEDIATE");
      expect(await (await request()).json()).toEqual({ ok: true, id: user.id });
    } finally {
      writer.close();
    }
  });
  test("event search keeps an exact total for empty pages and matches entity names", async () => {
    const { host } = fixture();
    const app = createApp(s);
    const login = await app.request("/api/login", {
      method: "POST",
      headers: { origin: s.config.origin },
      body: JSON.stringify({ username: "admin", password: "correct-password" }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    s.event(host.id, "operation.succeeded", {});
    s.event(null, "operation.succeeded", { message: "HOST" });
    s.event(host.id, "traffic.gap", {});
    const request = async (offset: number) =>
      (await app.request(`/api/activity/events?q=host&category=config&offset=${offset}`, {
        headers: { cookie },
      })).json();
    const first = await request(0);
    expect(first.total).toBe(2);
    expect(first.items.map((event: { entity: string | null }) => event.entity)).toEqual([host.id, null]);
    const empty = await request(5);
    expect(empty).toMatchObject({ items: [], total: 2, offset: 5, nextOffset: 5, hasMore: false });
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
      `/sub/${s.secrets(user.id).subscriptionToken}?format=mihomo`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("profile-title")).toBe(
      `base64:${Buffer.from("Jetyet · friend").toString("base64")}`,
    );
    expect(response.headers.get("profile-web-page-url")).toBe(s.config.origin);
    expect(response.headers.get("support-url")).toBe(
      "https://github.com/LyceumHewun/jetyet",
    );
    expect(response.headers.get("content-disposition")).toBe(
      "inline; filename*=UTF-8''Jetyet%20%C2%B7%20friend",
    );
    expect(await response.text()).toContain("203.0.113.1");
  });
  test("negotiates subscriptions, honors templates, and refuses empty access", async () => {
    const { user, node, template } = fixture();
    const app = createApp(s);
    const path = "/sub/" + s.secrets(user.id).subscriptionToken;
    const shadowrocket = { headers: { "User-Agent": "Shadowrocket/1" } };
    expect((await app.request(path)).status).toBe(406);
    const clash = await app.request(path, {
      headers: { "User-Agent": "Clash.Meta/1" },
    });
    expect(clash.headers.get("content-type")).toContain("text/yaml");
    const list = await app.request(path, shadowrocket);
    expect(list.headers.get("content-type")).toContain("text/plain");
    expect(Buffer.from(await list.text(), "base64").toString()).toContain(
      "@203.0.113.1:443/?insecure=1#Node",
    );
    const singBox = await app.request(path + "?format=sing-box", shadowrocket);
    expect(singBox.headers.get("content-type")).toContain("application/json");
    expect(await singBox.json()).toMatchObject({
      outbounds: expect.arrayContaining([
        {
          type: "hysteria2",
          tag: "Node",
          server: "203.0.113.1",
          server_port: 443,
          password: s.secrets(user.id).vpnToken,
          tls: { enabled: true, insecure: true },
          up_mbps: 1000,
          down_mbps: 1000,
        },
      ]),
    });
    const singBoxTemplate = s.get(user.defaultTemplates["sing-box"])!;
    const literalSelector = singBoxTemplate.body.replace(
      "{{ choices | json }}",
      JSON.stringify([node.name]),
    );
    const preview = JSON.parse(
      render(s, user, literalSelector, "assigned-preview", "sing-box"),
    );
    expect(
      preview.outbounds.find(
        (outbound: { tag: string }) => outbound.tag === "Proxy",
      ).outbounds,
    ).toEqual(["Preview node 1"]);
    expect(JSON.stringify(preview)).not.toContain(node.address);
    expect(preview.dns.final).toBe("cloudflare");
    expect(() =>
      render(
        s,
        user,
        singBoxTemplate.body.replace('"final": "Proxy"', '"final": "Missing"'),
        "live",
        "sing-box",
      ),
    ).toThrow("Invalid sing-box outbound reference");
    const selected = path + "?template=" + template.id;
    expect(
      (await app.request(selected, shadowrocket)).headers.get("content-type"),
    ).toContain("text/yaml");
    expect((await app.request(selected + "&format=sing-box")).status).toBe(400);
    s.put("node", { ...strip(node), enabled: false }, undefined, node.id);
    const emptyMihomo = await app.request(path + "?format=mihomo");
    expect(emptyMihomo.status).toBe(200);
    expect(YAML.parse(await emptyMihomo.text())["proxy-groups"][0].proxies).toEqual([
      "DIRECT",
    ]);
    const emptySingBox = await app.request(path + "?format=sing-box");
    expect(emptySingBox.status).toBe(200);
    expect(
      (await emptySingBox.json()).outbounds.find(
        (outbound: { tag: string }) => outbound.tag === "Proxy",
      ).outbounds,
    ).toEqual(["DIRECT"]);
    expect((await app.request(path + "?format=shadowrocket")).status).toBe(403);
  });
  test("subscription emits fields for the node's port and congestion modes", async () => {
    const { node, user } = fixture();
    const app = createApp(s);
    const url = `/sub/${s.secrets(user.id).subscriptionToken}?format=mihomo`;
    const {
      proxies: [single],
    } = YAML.parse(await (await app.request(url)).text());
    expect(single).toMatchObject({ port: 443, up: 1000, down: 1000 });
    expect(single).not.toHaveProperty("ports");
    expect(single).not.toHaveProperty("hop-interval");
    expect(single).not.toHaveProperty("bbr-profile");

    s.put(
      "node",
      {
        ...strip(node),
        hopping: "20000-50000",
        hopInterval: 30,
        congestion: "bbr",
      },
      undefined,
      node.id,
    );
    const {
      proxies: [hopping],
    } = YAML.parse(await (await app.request(url)).text());
    expect(hopping).toMatchObject({
      ports: "20000-50000",
      "hop-interval": 30,
      "bbr-profile": "standard",
    });
    expect(hopping).not.toHaveProperty("port");
    expect(hopping).not.toHaveProperty("up");
    expect(hopping).not.toHaveProperty("down");
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
    expect(
      (await post(path, { token: active, password: "short" })).status,
    ).toBe(400);
    const initial = await post(path, {
      token: active,
      password: "first6",
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
          password: "first6",
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
      { ...strip(user), name: "Other", username: "other" },
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
    const spawn = Bun.spawn.bind(Bun);
    const validate = spyOn(Bun, "spawn");
    try {
      validate.mockImplementation(() => {
        throw Error("Core unavailable");
      });
      expect((await request(root + "/publish", "POST")).status).toBe(503);
      validate.mockImplementation(() =>
        spawn([process.execPath, "-e", "process.exit(1)"]),
      );
      expect((await request(root + "/publish", "POST")).status).toBe(422);
      validate.mockImplementation(() =>
        spawn([process.execPath, "-e", "process.exit(0)"]),
      );
      expect((await request(root + "/publish", "POST")).status).toBe(200);
      expect(validate).toHaveBeenCalledTimes(3);
    } finally {
      validate.mockRestore();
    }
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
    expect((await subscription(user, "?format=mihomo")).status).toBe(200);
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
      deploymentScript(s, node, "v2.14.0", false, {
        protocol: "hysteria2",
        congestion: "bbr",
        tuning: false,
        tlsSecurity: "pinned",
        sni: `${"a".repeat(63)}.example.com`,
        ech: true,
        echPublicName: "cloudflare-ech.com",
      }),
      deploymentScript(
        s,
        {
          ...node,
          tlsSecurity: "pinned",
          sni: "bing.com",
          ech: true,
          echPublicName: "cloudflare-ech.com",
        },
        "v2.14.0",
        false,
        {
          protocol: "hysteria2",
          congestion: "brutal",
          tuning: false,
          tlsSecurity: "legacy",
          sni: "",
          ech: false,
          echPublicName: "",
        },
      ),
      detectionScript,
      controlledProbeScript,
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
  test.each(["deploy", "detect"] as const)(
    "%s preserves the published mode if the service cannot stop",
    async (kind) => {
      const { host, node } = fixture();
      s.put(
        "node",
        { ...strip(node), enabled: kind === "detect", congestion: "brutal" },
        undefined,
        node.id,
      );
      const version = "v2.13.0";
      const options = {
        protocol: "hysteria2",
        congestion: "bbr",
        tuning: true,
      } as const;
      const tuningLog = "Adaptive tuning: existing swap preserved";
      const hash = digest(serverConfig(s, node, options));
      enqueue(
        s,
        host.id,
        kind,
        kind === "deploy"
          ? { nodeId: node.id, version, ...options }
          : { nodeId: node.id },
      );
      const task = claim(s, false, "ops")!;
      let active = kind === "deploy";
      await expect(
        runOperation(s, task, async (script) => {
          if (script.includes("systemctl start jetyet-hysteria.service")) {
            active = true;
            s.put(
              "node",
              { ...strip(s.get(node.id)!), enabled: false },
              undefined,
              node.id,
            );
            return "";
          }
          if (script.includes("systemctl stop jetyet-hysteria.service"))
            throw Error("Unable to stop");
          if (script !== detectionScript) return tuningLog;
          return JSON.stringify({
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
            active,
          });
        }),
      ).rejects.toThrow("Unable to stop");
      expect(s.get(node.id)?.congestion).toBe("brutal");
      if (kind === "deploy")
        expect(
          s.db
            .query<{ message: string }, [string]>(
              "SELECT message FROM task_logs WHERE task=? ORDER BY id",
            )
            .all(task.id)
            .map(({ message }) => message),
        ).toContain(tuningLog);
    },
  );

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
    expect(command).toContain('&& bash "$file"');
    expect(command).not.toContain("\n");
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
    const manifest = (installedVersion: string) =>
      JSON.stringify({
        ...options,
        owner: "jetyet",
        phase: "ready",
        version: installedVersion,
        actualVersion: installedVersion,
        nodeId: node.id,
        hostId: host.id,
        address: node.address,
        port: node.port,
        hopping: node.hopping,
        configHash: hash,
        actualHash: hash,
        active: true,
      });
    enqueue(s, host.id, "detect", { nodeId: node.id });
    const unsupported = claim(s, false, "ops")!;
    await expect(
      runOperation(s, unsupported, async () => manifest("v2.7.1")),
    ).rejects.toThrow("BBR mode requires Hysteria 2 v2.8.0 or later");
    finish(s, unsupported, "failed");
    expect(render(s, user, defaultTemplate)).toContain("up: 1000");

    enqueue(s, host.id, "detect", { nodeId: node.id });
    const task = claim(s, false, "ops")!;
    await runOperation(s, task, async () => manifest(version));
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
    let stopped = false;
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
      if (script.includes("systemctl stop")) {
        stopped = true;
        return "";
      }
      detects++;
      return manifest(detects > 1 && !stopped);
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

  test("per-node upgrade transitions legacy nodes to pinned SNI + pinSHA256 + ECH, rejects stale/unverified state, supports downgrade, and scrubs literal preview TLS metadata", async () => {
    const { host, node, user } = fixture();
    const app = createApp(s);
    const certSha256 = "ab".repeat(32);
    const certSpkiSha256 = Buffer.alloc(32, 7).toString("base64");
    const subBase = `/sub/${s.secrets(user.id).subscriptionToken}`;

    // Construct a real RFC 9849 ECHConfigList + ECH KEYS PEM using matched X25519 keypairs and a leading unknown version entry
    const u16 = (n: number) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
    const makeX25519Pair = () => {
      const pair = generateKeyPairSync("x25519");
      const privDer = pair.privateKey.export({ format: "der", type: "pkcs8" });
      const pubDer = pair.publicKey.export({ format: "der", type: "spki" });
      return {
        priv: Buffer.from(privDer.subarray(privDer.length - 32)),
        pub: Buffer.from(pubDer.subarray(pubDer.length - 32)),
      };
    };
    const buildEchConfig = (
      publicName: string,
      pub: Buffer,
      version = 0xfe0d,
    ) => {
      if (version !== 0xfe0d) {
        const body = Buffer.from([1, 2, 3, 4]);
        return Buffer.concat([u16(version), u16(body.length), body]);
      }
      const cs = Buffer.from([0x00, 0x01, 0x00, 0x01]);
      const pn = Buffer.from(publicName, "ascii");
      const contents = Buffer.concat([
        Buffer.from([0x01]),
        u16(0x0020),
        u16(pub.length),
        pub,
        u16(cs.length),
        cs,
        Buffer.from([64]),
        Buffer.from([pn.length]),
        pn,
        u16(0),
      ]);
      return Buffer.concat([u16(0xfe0d), u16(contents.length), contents]);
    };
    const k1 = makeX25519Pair();
    const k2 = makeX25519Pair();
    const unknownCfg = buildEchConfig("ignored.example", k1.pub, 0xfe0c);
    const realCfg = buildEchConfig("cloudflare-ech.com", k2.pub, 0xfe0d);
    const allCfgs = Buffer.concat([unknownCfg, realCfg]);
    const authoritativeList = Buffer.concat([u16(allCfgs.length), allCfgs]);
    const echConfig = authoritativeList.toString("base64");

    // Verify the Python authoritative ECH KEYS parser derives the exact list even when ECH CONFIGS differs
    const keysBlob = Buffer.concat([
      u16(k1.priv.length),
      k1.priv,
      u16(unknownCfg.length),
      unknownCfg,
      u16(k2.priv.length),
      k2.priv,
      u16(realCfg.length),
      realCfg,
    ]);
    const staleList = Buffer.concat([
      u16(buildEchConfig("stale.example", k1.pub).length),
      buildEchConfig("stale.example", k1.pub),
    ]);
    const mismatchedPem = [
      "-----BEGIN ECH KEYS-----",
      keysBlob.toString("base64"),
      "-----END ECH KEYS-----",
      "-----BEGIN ECH CONFIGS-----",
      "!!!not-valid-base64-padding===",
      "-----END ECH CONFIGS-----",
    ].join("\n");
    const parseRes = Bun.spawnSync(
      [
        "python3",
        "-c",
        `import base64,json,re,struct,sys,tempfile\n${echKeysParserPy}\nwith tempfile.NamedTemporaryFile('w') as f:\n f.write(sys.stdin.read()); f.flush()\n print(json.dumps(parse_ech_keys_file(f.name)))`,
      ],
      { stdin: Buffer.from(mismatchedPem), stdout: "pipe", stderr: "pipe" },
    );
    expect(parseRes.exitCode).toBe(0);
    const parsedEch = JSON.parse(parseRes.stdout.toString());
    expect(parsedEch.echConfig).toBe(echConfig);
    expect(parsedEch.publicNames).toEqual(["cloudflare-ech.com"]);
    expect(parsedEch.configsBlockMatches).toBe(false);

    // Long SNI (>64 chars) keeps a bounded CN <= 64 while preserving full DNS SAN
    const longSni = `${"a".repeat(63)}.example.com`;
    const longSniScript = deploymentScript(s, node, "v2.14.0", false, {
      protocol: "hysteria2",
      congestion: "brutal",
      tuning: false,
      tlsSecurity: "pinned",
      sni: longSni,
      ech: false,
      echPublicName: "",
    });
    expect(longSniScript).toContain("'/CN=jetyet-node'");
    expect(longSniScript).toContain(`'subjectAltName=DNS:${longSni}'`);

    // Legacy node stays compatible before upgrade
    const legacyMihomo = YAML.parse(
      await (await app.request(`${subBase}?format=mihomo`)).text(),
    ).proxies[0];
    expect(legacyMihomo["skip-cert-verify"]).toBe(true);
    expect(legacyMihomo.fingerprint).toBeUndefined();
    expect(legacyMihomo["ech-opts"]).toBeUndefined();

    const legacySingBox = JSON.parse(
      await (await app.request(`${subBase}?format=sing-box`)).text(),
    ).outbounds.find((o: any) => o.type === "hysteria2");
    expect(legacySingBox.tls).toEqual({ enabled: true, insecure: true });

    const legacyShadowrocket = Buffer.from(
      await (await app.request(`${subBase}?format=shadowrocket`)).text(),
      "base64",
    ).toString("utf8");
    expect(legacyShadowrocket).toContain("?insecure=1#");
    expect(legacyShadowrocket).not.toContain("pinSHA256=");

    const login = await app.request("/api/login", {
      method: "POST",
      headers: { origin: s.config.origin },
      body: JSON.stringify({ username: "ADMIN", password: "correct-password" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];

    // Mint a legacy manual install link BEFORE upgrade to verify it becomes stale afterward
    const issuedLegacy = await app.request(`/api/nodes/${node.id}/command`, {
      method: "POST",
      headers: { origin: s.config.origin, cookie },
      body: JSON.stringify({
        version: "v2.13.0",
        protocol: "hysteria2",
        congestion: "brutal",
        tuning: false,
        tlsSecurity: "legacy",
        sni: "",
        ech: false,
        echPublicName: "",
      }),
    });
    expect(issuedLegacy.status).toBe(200);
    const legacyLinkPath = new URL(
      (await issuedLegacy.json()).command.match(/https:\/\/[^']+/)[0],
    ).pathname;
    expect((await app.request(legacyLinkPath)).status).toBe(200);

    // Reject pinned TLS on Hysteria < v2.6.4 and ECH on Hysteria < v2.12.3
    const tooOldPinned = await app.request(`/api/nodes/${node.id}/operation`, {
      method: "POST",
      headers: { origin: s.config.origin, cookie },
      body: JSON.stringify({
        kind: "upgrade",
        version: "v2.6.3",
        protocol: "hysteria2",
        congestion: "brutal",
        tuning: false,
        tlsSecurity: "pinned",
        sni: "",
        ech: false,
        echPublicName: "",
      }),
    });
    expect(tooOldPinned.status).toBe(400);

    const tooOldEch = await app.request(`/api/nodes/${node.id}/operation`, {
      method: "POST",
      headers: { origin: s.config.origin, cookie },
      body: JSON.stringify({
        kind: "upgrade",
        version: "v2.12.2",
        protocol: "hysteria2",
        congestion: "brutal",
        tuning: false,
        tlsSecurity: "pinned",
        sni: "",
        ech: true,
        echPublicName: "",
      }),
    });
    expect(tooOldEch.status).toBe(400);

    // Queue two concurrent upgrades from the same snapshot; second must be rejected as stale
    const queued = await app.request(`/api/nodes/${node.id}/operation`, {
      method: "POST",
      headers: { origin: s.config.origin, cookie },
      body: JSON.stringify({
        kind: "upgrade",
        version: "v2.14.0",
        protocol: "hysteria2",
        congestion: "bbr",
        tuning: false,
        tlsSecurity: "pinned",
        sni: "",
        ech: true,
        echPublicName: "",
      }),
    });
    expect(queued.status).toBe(202);
    const staleQueued = await app.request(`/api/nodes/${node.id}/operation`, {
      method: "POST",
      headers: { origin: s.config.origin, cookie },
      body: JSON.stringify({
        kind: "upgrade",
        version: "v2.13.0",
        protocol: "hysteria2",
        congestion: "brutal",
        tuning: false,
        tlsSecurity: "legacy",
        sni: "",
        ech: false,
        echPublicName: "",
      }),
    });
    expect(staleQueued.status).toBe(202);

    const upgradedOptions = {
      protocol: "hysteria2" as const,
      congestion: "bbr" as const,
      tuning: false,
      tlsSecurity: "pinned" as const,
      sni: "bing.com",
      ech: true,
      echPublicName: "cloudflare-ech.com",
    };
    const expectedHash = digest(serverConfig(s, node, upgradedOptions));
    const task = claim(s, false, "ops")!;
    // Reject if live TLS handshake verification fails
    await expect(
      runOperation(s, task, async (script) => {
        if (script !== detectionScript) return "Deployment verified";
        return JSON.stringify({
          ...upgradedOptions,
          owner: "jetyet",
          phase: "ready",
          version: "v2.14.0",
          actualVersion: "v2.14.0",
          nodeId: node.id,
          hostId: host.id,
          address: node.address,
          port: node.port,
          hopping: node.hopping,
          configHash: expectedHash,
          actualHash: expectedHash,
          certSha256,
          certSpkiSha256,
          certDnsSans: ["bing.com"],
          echConfig,
          echDetectedPublicNames: ["cloudflare-ech.com"],
          echDetectedPublicName: "cloudflare-ech.com",
          runtimeFresh: true,
          liveTlsVerified: false,
          active: true,
        });
      }),
    ).rejects.toThrow("Deployed configuration verification failed");
    finish(s, task, "failed");

    const staleTask = claim(s, false, "ops")!;
    finish(s, staleTask, "cancelled");
    const retryQueued = await app.request(`/api/nodes/${node.id}/operation`, {
      method: "POST",
      headers: { origin: s.config.origin, cookie },
      body: JSON.stringify({
        kind: "upgrade",
        version: "v2.14.0",
        protocol: "hysteria2",
        congestion: "bbr",
        tuning: false,
        tlsSecurity: "pinned",
        sni: "",
        ech: true,
        echPublicName: "",
      }),
    });
    expect(retryQueued.status).toBe(202);
    const upgradeTask = claim(s, false, "ops")!;
    await runOperation(s, upgradeTask, async (script) => {
      if (script !== detectionScript) return "Deployment verified";
      return JSON.stringify({
        ...upgradedOptions,
        owner: "jetyet",
        phase: "ready",
        version: "v2.14.0",
        actualVersion: "v2.14.0",
        nodeId: node.id,
        hostId: host.id,
        address: node.address,
        port: node.port,
        hopping: node.hopping,
        configHash: expectedHash,
        actualHash: expectedHash,
        certSha256,
        certSpkiSha256,
        certDnsSans: ["bing.com"],
        echConfig,
        echDetectedPublicNames: ["cloudflare-ech.com"],
        echDetectedPublicName: "cloudflare-ech.com",
        runtimeFresh: true,
        liveTlsVerified: true,
        active: true,
      });
    });
    finish(s, upgradeTask, "succeeded");

    // Stale manual link minted before upgrade now returns 404
    expect((await app.request(legacyLinkPath)).status).toBe(404);
    // Re-running a task carrying the pre-upgrade expectedRevision is rejected
    await expect(
      runOperation(s, staleTask, async () => "should not execute"),
    ).rejects.toThrow("Node state changed since this operation was queued");

    // Activity retry API rejects stale pre-upgrade tasks instead of requeuing them
    const staleRetryRes = await app.request(`/api/tasks/${staleTask.id}/retry`, {
      method: "POST",
      headers: { origin: s.config.origin, cookie },
    });
    expect(staleRetryRes.status).toBe(400);

    // Subscriptions now publish pinned SNI + pinSHA256 + ECH across all formats
    const mihomoProxy = YAML.parse(
      await (await app.request(`${subBase}?format=mihomo`)).text(),
    ).proxies[0];
    expect(mihomoProxy).toMatchObject({
      sni: "bing.com",
      fingerprint: certSha256,
      "skip-cert-verify": false,
      "ech-opts": { enable: true, config: echConfig },
    });

    const singBoxOutbound = JSON.parse(
      await (await app.request(`${subBase}?format=sing-box`)).text(),
    ).outbounds.find((o: any) => o.type === "hysteria2");
    expect(singBoxOutbound.tls).toEqual({
      enabled: true,
      server_name: "bing.com",
      insecure: false,
      certificate_public_key_sha256: [certSpkiSha256],
      ech: {
        enabled: true,
        config: [
          "-----BEGIN ECH CONFIGS-----",
          echConfig,
          "-----END ECH CONFIGS-----",
        ],
      },
    });

    const shadowrocketUri = Buffer.from(
      await (await app.request(`${subBase}?format=shadowrocket`)).text(),
      "base64",
    ).toString("utf8");
    const parsedUri = new URL(shadowrocketUri);
    expect(parsedUri.searchParams.get("sni")).toBe("bing.com");
    expect(parsedUri.searchParams.get("insecure")).toBe("1");
    expect(parsedUri.searchParams.get("pinSHA256")).toBe(certSha256);
    expect(parsedUri.searchParams.get("ech")).toBe(echConfig);

    // Portal previews hide real SNI, pins, ECH config, and literal template TLS fields / URIs / DNS TLS
    const literalMihomoTemplate = `${defaultTemplate}
proxy-providers:
  ext:
    type: http
    url: "hysteria2://pw@1.2.3.4:443/?sni=secret.sni.example&pinSHA256=${certSha256}&ech=${encodeURIComponent(echConfig)}"
`;
    const mihomoPreview = render(
      s,
      user,
      literalMihomoTemplate.replace(
        "{{ proxies | yaml | indent: 2 }}",
        `{{ proxies | yaml | indent: 2 }}\n  - name: Literal\n    type: hysteria2\n    server: 198.51.100.9\n    port: 443\n    password: p\n    sni: literal.sni.example\n    name-cert-verify: verify.sni.example\n    fingerprint: ${certSha256}`,
      ),
      "assigned-preview",
      "mihomo",
    );
    expect(mihomoPreview).not.toContain("bing.com");
    expect(mihomoPreview).not.toContain("secret.sni.example");
    expect(mihomoPreview).not.toContain("literal.sni.example");
    expect(mihomoPreview).not.toContain("verify.sni.example");
    expect(mihomoPreview).not.toContain(certSha256);
    expect(mihomoPreview).not.toContain(echConfig);

    const singBoxPreview = render(
      s,
      user,
      defaultSingBoxTemplate
        .replace(
          '{"type": "https", "tag": "cloudflare", "server": "1.1.1.1"}',
          `{"type": "https", "tag": "cloudflare", "server": "1.1.1.1", "tls": {"enabled": true, "server_name": "dns-secret.example", "ech": {"enabled": true, "config": ["-----BEGIN ECH CONFIGS-----", "${echConfig}", "-----END ECH CONFIGS-----"]}}}`,
        )
        .replace(
          '"final": "Proxy"',
          `"rule_set": [{"type": "remote", "tag": "rs", "url": "https://example.com/rules.srs?sni=secret.sb.example&pinSHA256=${certSha256}&ech=${encodeURIComponent(echConfig)}"}], "final": "Proxy"`,
        ),
      "assigned-preview",
      "sing-box",
    );
    expect(singBoxPreview).not.toContain("bing.com");
    expect(singBoxPreview).not.toContain("dns-secret.example");
    expect(singBoxPreview).not.toContain("secret.sb.example");
    expect(singBoxPreview).not.toContain(certSpkiSha256);
    expect(singBoxPreview).not.toContain(certSha256);
    expect(singBoxPreview).not.toContain(echConfig);

    // Monitor collector runs against real SQLite tasks schema: skips drift while an op runs, flags abandoned installing phase
    const baseSample = {
      inbound: 100,
      outbound: 200,
      ifaceEpoch: "eth0",
      boot: "boot-1",
      uptime: 1000,
      cpuTotal: 100,
      cpuIdle: 50,
      memory: 20,
      disk: 10,
      service: false,
      configHash: expectedHash,
      config: serverConfig(s, s.get(node.id)!),
      certSha256,
      echConfig,
      manifest: {
        ...upgradedOptions,
        owner: "jetyet",
        phase: "installing",
        nodeId: node.id,
        hostId: host.id,
        port: node.port,
        hopping: node.hopping,
      },
    };
    enqueue(s, host.id, "upgrade", { nodeId: node.id });
    const runningOp = claim(s, false, "ops")!;
    await collectHost(s, s.get(host.id)!, async () =>
      JSON.stringify(baseSample),
    );
    expect(s.get(node.id)?.drift).not.toBe(true);
    finish(s, runningOp, "failed");
    // Monitor skips node updates and accounting while remote lock is busy (preserving existing counter epochs), then alerts drift once unlocked
    nodeDelta(s, node.id, "boot-1:inv-1", 500, 700, now);
    addObservation(
      s,
      user,
      `node:${node.id}:user:${user.id}`,
      "boot-1:inv-1",
      500,
      700,
      now,
    );
    await collectHost(s, s.get(host.id)!, async () =>
      JSON.stringify({
        ...baseSample,
        service: true,
        operationLockBusy: true,
      }),
    );
    expect(s.get(node.id)?.drift).not.toBe(true);
    const totalAfterBusy = s.db
      .query<{ epoch: string; inbound: number; outbound: number }, [string]>(
        "SELECT epoch,inbound,outbound FROM counters WHERE source=?",
      )
      .get(`node-total:${node.id}`);
    expect(totalAfterBusy).toEqual({
      epoch: "boot-1:inv-1",
      inbound: 500,
      outbound: 700,
    });
    const userAfterBusy = s.db
      .query<{ epoch: string; inbound: number; outbound: number }, [string]>(
        "SELECT epoch,inbound,outbound FROM counters WHERE source=?",
      )
      .get(`node:${node.id}:user:${user.id}`);
    expect(userAfterBusy).toEqual({
      epoch: "boot-1:inv-1",
      inbound: 500,
      outbound: 700,
    });
    const nextDelta = nodeDelta(s, node.id, "boot-1:inv-1", 650, 900, now + 60000);
    expect(nextDelta).toEqual({ inbound: 150, outbound: 200 });
    await collectHost(s, s.get(host.id)!, async () =>
      JSON.stringify(baseSample),
    );
    expect(s.get(node.id)?.drift).toBe(true);

    // Wildcard *.invalid SAN does not cause non-terminating negative SNI search
    const wildcardCheck = Bun.spawnSync(
      [
        "python3",
        "-c",
        `forbidden={'bing.com','*.invalid'}
def san_covers(pattern, candidate):
 pattern=pattern.lower()
 if pattern==candidate: return True
 if pattern.startswith('*.'):
  pl=pattern.split('.'); cl=candidate.split('.')
  return len(pl)==len(cl) and pl[1:]==cl[1:]
 return False
neg=None
for idx in range(64):
 cand='jetyet-sni-mismatch.invalid' if idx==0 else f'jetyet-sni-mismatch-{idx}.probe-{idx}.invalid'
 if not any(san_covers(s, cand) for s in forbidden):
  neg=cand
  break
print(neg or '')`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(wildcardCheck.exitCode).toBe(0);
    expect(wildcardCheck.stdout.toString().trim()).toBe(
      "jetyet-sni-mismatch-1.probe-1.invalid",
    );

    // probeNode snapshots the executable so an in-place binary rollback after approval cannot bypass the version gate
    const fakeBinPath = join(dir, "fake-hysteria");
    writeFileSync(
      fakeBinPath,
      `#!/bin/sh
if [ "$1" = "version" ]; then
  echo "Version: v2.6.3"
  exit 0
fi
exit 1
`,
    );
    chmodSync(fakeBinPath, 0o755);
    const origBin = s.config.hysteriaBinary;
    s.config.hysteriaBinary = fakeBinPath;
    try {
      await expect(probeNode(s, s.get(node.id)!)).rejects.toThrow(
        "v2.6.4 or later",
      );
      // Replace fake binary with v2.14.0 that mutates the original path during version check; snapshot must still run v2.14.0 logic (not replaced file)
      const ranMarker = join(dir, "probe-ran-v214");
      writeFileSync(
        fakeBinPath,
        `#!/bin/sh
if [ "$1" = "version" ]; then
  printf '#!/bin/sh\\necho bad > ${ranMarker}\\nexit 1\\n' > "${fakeBinPath}"
  echo "Version: v2.14.0"
  exit 0
fi
echo "snapshot-ok" > "${ranMarker}"
exit 1
`,
      );
      chmodSync(fakeBinPath, 0o755);
      await expect(probeNode(s, s.get(node.id)!)).rejects.toThrow(
        "Probe client exited",
      );
      expect(await Bun.file(ranMarker).text()).toBe("snapshot-ok\n");
    } finally {
      s.config.hysteriaBinary = origBin;
    }

    // Disabled node Detect performs lock-serialized controlledProbeScript before publishing and rejects failed live proof
    s.put(
      "node",
      { ...strip(s.get(node.id)!), enabled: false },
      undefined,
      node.id,
    );
    const inactiveManifest = {
      ...upgradedOptions,
      owner: "jetyet",
      phase: "ready",
      version: "v2.14.0",
      actualVersion: "v2.14.0",
      nodeId: node.id,
      hostId: host.id,
      address: node.address,
      port: node.port,
      hopping: node.hopping,
      configHash: expectedHash,
      actualHash: expectedHash,
      certSha256,
      certSpkiSha256,
      certDnsSans: ["bing.com"],
      echConfig,
      echDetectedPublicNames: ["cloudflare-ech.com"],
      echDetectedPublicName: "cloudflare-ech.com",
      active: false,
    };
    enqueue(s, host.id, "detect", { nodeId: node.id });
    const failedDisabledDetect = claim(s, false, "ops")!;
    await expect(
      runOperation(s, failedDisabledDetect, async (script) => {
        if (script === controlledProbeScript)
          return JSON.stringify({
            ...inactiveManifest,
            runtimeFresh: true,
            liveTlsVerified: false,
            controlledProbe: true,
          });
        return JSON.stringify(inactiveManifest);
      }),
    ).rejects.toThrow("Live TLS verification failed for stopped deployment");
    finish(s, failedDisabledDetect, "failed");

    enqueue(s, host.id, "detect", { nodeId: node.id });
    const disabledDetect = claim(s, false, "ops")!;
    let ranControlledProbe = false;
    await runOperation(s, disabledDetect, async (script) => {
      if (script === controlledProbeScript) {
        ranControlledProbe = true;
        return JSON.stringify({
          ...inactiveManifest,
          runtimeFresh: true,
          liveTlsVerified: true,
          controlledProbe: true,
        });
      }
      return JSON.stringify(inactiveManifest);
    });
    finish(s, disabledDetect, "succeeded");
    expect(ranControlledProbe).toBe(true);
    s.put(
      "node",
      { ...strip(s.get(node.id)!), enabled: true },
      undefined,
      node.id,
    );

    // Downgrade pinned node back to legacy: refuses stale DNS-SAN cert, succeeds once legacy cert has no DNS SAN
    const downgradeQueued = await app.request(
      `/api/nodes/${node.id}/operation`,
      {
        method: "POST",
        headers: { origin: s.config.origin, cookie },
        body: JSON.stringify({
          kind: "upgrade",
          version: "v2.14.0",
          protocol: "hysteria2",
          congestion: "brutal",
          tuning: false,
          tlsSecurity: "legacy",
          sni: "",
          ech: false,
          echPublicName: "",
        }),
      },
    );
    expect(downgradeQueued.status).toBe(202);
    const legacyOptions = {
      protocol: "hysteria2" as const,
      congestion: "brutal" as const,
      tuning: false,
      tlsSecurity: "legacy" as const,
      sni: "",
      ech: false,
      echPublicName: "",
    };
    const legacyHash = digest(serverConfig(s, node, legacyOptions));
    const downgradeTask = claim(s, false, "ops")!;
    await expect(
      runOperation(s, downgradeTask, async (script) => {
        if (script !== detectionScript) return "Deployment verified";
        return JSON.stringify({
          ...legacyOptions,
          owner: "jetyet",
          phase: "ready",
          version: "v2.14.0",
          actualVersion: "v2.14.0",
          nodeId: node.id,
          hostId: host.id,
          address: node.address,
          port: node.port,
          hopping: node.hopping,
          configHash: legacyHash,
          actualHash: legacyHash,
          certDnsSans: ["bing.com"],
          runtimeFresh: true,
          liveTlsVerified: true,
          active: true,
        });
      }),
    ).rejects.toThrow("Deployed configuration verification failed");
    await runOperation(s, downgradeTask, async (script) => {
      if (script !== detectionScript) return "Deployment verified";
      return JSON.stringify({
        ...legacyOptions,
        owner: "jetyet",
        phase: "ready",
        version: "v2.14.0",
        actualVersion: "v2.14.0",
        nodeId: node.id,
        hostId: host.id,
        address: node.address,
        port: node.port,
        hopping: node.hopping,
        configHash: legacyHash,
        actualHash: legacyHash,
        certDnsSans: [],
        runtimeFresh: true,
        liveTlsVerified: true,
        active: true,
      });
    });
    expect(s.get(node.id)?.tlsSecurity).toBe("legacy");
    expect(s.get(node.id)?.ech).toBe(false);
    expect(s.get(node.id)?.certSha256).toBe("");
  });
});
