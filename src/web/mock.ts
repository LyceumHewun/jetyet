import type { Row, State } from "./types";

const GiB = 1024 ** 3;
const TiB = 1024 ** 4;
const now = () => Date.now();
const hour = 3600 * 1000;
const day = 24 * hour;

function createMockState(): State {
  const t = now();
  return {
    origin: window.location.origin,
    workers: [
      { name: "monitor", at: t - 4000 },
      { name: "operations", at: t - 6000 },
    ],
    hosts: [
      {
        id: "host-hk",
        kind: "host",
        name: "hk-kowloon-01",
        address: "103.214.168.42",
        port: 22,
        enabled: true,
        reachable: true,
        fingerprint: "SHA256:9f8kL2xP4qR7vT1wN5mB8cZ3yH6jD0sA2eF4gU1iV8o",
        cpu: 34,
        memory: 52,
        disk: 41,
        lastSeen: t - 12000,
        uptime: 18 * 86400 + 6 * 3600,
        exhausted: false,
        deleting: false,
        quota: { limit: TiB, direction: "both" },
        usage: {
          inbound: 185 * GiB,
          outbound: 235 * GiB,
          next: t + 11 * day,
        },
        created: t - 45 * day,
      },
      {
        id: "host-jp",
        kind: "host",
        name: "jp-tokyo-iij",
        address: "45.76.204.19",
        port: 22,
        enabled: true,
        reachable: true,
        fingerprint: "SHA256:4a7cE9mK2pX5vN8qW1rT6yB3uJ0hF2dS8gL5zC4nM7k",
        cpu: 71,
        memory: 68,
        disk: 58,
        lastSeen: t - 15000,
        uptime: 9 * 86400 + 14 * 3600,
        exhausted: false,
        deleting: false,
        quota: { limit: TiB, direction: "both" },
        usage: {
          inbound: 310 * GiB,
          outbound: 392 * GiB,
          next: t + 5 * day,
        },
        created: t - 32 * day,
      },
      {
        id: "host-de",
        kind: "host",
        name: "de-frankfurt-02",
        address: "185.199.110.88",
        port: 2222,
        enabled: true,
        reachable: true,
        fingerprint: "SHA256:7x2mP9kQ4wR1vN6tB8yH3jD5sA0eF2gU4iV8oL1cZ9p",
        cpu: 18,
        memory: 39,
        disk: 29,
        lastSeen: t - 9000,
        uptime: 41 * 86400 + 3 * 3600,
        exhausted: false,
        deleting: false,
        quota: { limit: 2 * TiB, direction: "both" },
        usage: {
          inbound: 92 * GiB,
          outbound: 128 * GiB,
          next: t + 19 * day,
        },
        created: t - 60 * day,
      },
      {
        id: "host-us",
        kind: "host",
        name: "us-la-edge",
        address: "64.112.44.107",
        port: 22,
        enabled: true,
        reachable: false,
        fingerprint: "",
        cpu: 91,
        memory: 86,
        disk: 89,
        lastSeen: t - 9 * 60 * 1000,
        usageStale: true,
        uptime: 2 * 86400 + 1 * 3600,
        exhausted: true,
        deleting: false,
        quota: { limit: TiB, direction: "both" },
        usage: {
          inbound: 512 * GiB,
          outbound: 512 * GiB,
          next: t + 2 * day,
        },
        created: t - 20 * day,
      },
    ],
    nodes: [
      {
        id: "node-hk",
        kind: "node",
        name: "HK-Kowloon",
        hostId: "host-hk",
        address: "hk.edge.example.com",
        port: 443,
        enabled: true,
        status: "deployed",
        service: true,
        probe: "healthy",
        probed: t - 25000,
        version: "v2.6.1",
        hopping: "20000-50000",
        upMbps: 500,
        downMbps: 500,
        drift: false,
        online: { "user-alice": 2, "user-bob": 1, "user-diana": 1 },
        created: t - 44 * day,
      },
      {
        id: "node-jp",
        kind: "node",
        name: "JP-Tokyo",
        hostId: "host-jp",
        address: "jp.edge.example.com",
        port: 8443,
        enabled: true,
        status: "deployed",
        service: true,
        probe: "healthy",
        probed: t - 18000,
        version: "v2.6.1",
        drift: false,
        online: { "user-alice": 1, "user-diana": 2 },
        created: t - 30 * day,
      },
      {
        id: "node-de",
        kind: "node",
        name: "DE-Frankfurt",
        hostId: "host-de",
        address: "de.edge.example.com",
        port: 443,
        enabled: true,
        status: "deployed",
        service: true,
        probe: "healthy",
        probed: t - 32000,
        version: "v2.5.4",
        drift: true,
        online: { "user-bob": 1 },
        created: t - 58 * day,
      },
      {
        id: "node-us",
        kind: "node",
        name: "US-LA",
        hostId: "host-us",
        address: "us.edge.example.com",
        port: 443,
        enabled: true,
        status: "deployed",
        service: false,
        probe: "timeout",
        probed: t - 12 * 60 * 1000,
        version: "v2.6.0",
        drift: false,
        online: {},
        created: t - 19 * day,
      },
    ],
    users: [
      {
        id: "user-alice",
        kind: "user",
        name: "alice",
        note: "Workstation & iPhone",
        enabled: true,
        exhausted: false,
        expires: null,
        nodeIds: ["node-hk", "node-jp", "node-de"],
        quota: { limit: 100 * GiB, direction: "both" },
        usage: {
          inbound: 28 * GiB,
          outbound: 34 * GiB,
          next: t + 14 * day,
        },
        created: t - 40 * day,
      },
      {
        id: "user-bob",
        kind: "user",
        name: "bob",
        note: "Home router",
        enabled: true,
        exhausted: false,
        expires: null,
        nodeIds: ["node-hk", "node-de"],
        quota: { limit: 200 * GiB, direction: "both" },
        usage: {
          inbound: 14 * GiB,
          outbound: 22 * GiB,
          next: t + 21 * day,
        },
        created: t - 28 * day,
      },
      {
        id: "user-charlie",
        kind: "user",
        name: "charlie",
        note: "Trial quota",
        enabled: true,
        exhausted: true,
        expires: null,
        nodeIds: ["node-hk", "node-jp"],
        quota: { limit: 50 * GiB, direction: "both" },
        usage: {
          inbound: 24 * GiB,
          outbound: 26 * GiB,
          next: t + 3 * day,
        },
        created: t - 25 * day,
      },
      {
        id: "user-diana",
        kind: "user",
        name: "diana",
        note: "Unlimited team member",
        enabled: true,
        exhausted: false,
        expires: null,
        nodeIds: ["node-hk", "node-jp", "node-de", "node-us"],
        quota: { limit: null, direction: "both" },
        usage: {
          inbound: 68 * GiB,
          outbound: 79 * GiB,
          next: t + 10 * day,
        },
        created: t - 50 * day,
      },
      {
        id: "user-evan",
        kind: "user",
        name: "evan",
        note: "Short-term guest",
        enabled: true,
        exhausted: false,
        expires: new Date(t - 2 * day).toISOString(),
        nodeIds: ["node-jp"],
        quota: { limit: 50 * GiB, direction: "both" },
        usage: {
          inbound: 5 * GiB,
          outbound: 7 * GiB,
          next: t + 7 * day,
        },
        created: t - 15 * day,
      },
      {
        id: "user-frank",
        kind: "user",
        name: "frank",
        note: "Paused account",
        enabled: false,
        exhausted: false,
        expires: null,
        nodeIds: ["node-hk"],
        quota: { limit: 100 * GiB, direction: "both" },
        usage: {
          inbound: 2 * GiB,
          outbound: 2 * GiB,
          next: t + 16 * day,
        },
        created: t - 35 * day,
      },
    ],
    templates: [
      {
        id: "tpl-smart",
        name: "Global Smart",
        published: true,
        body: `mixed-port: 7890
allow-lan: false
mode: rule
log-level: warning
dns:
  enable: true
  enhanced-mode: fake-ip
  nameserver:
    - https://1.1.1.1/dns-query`,
        draft: "",
      },
      {
        id: "tpl-stream",
        name: "Streaming Split",
        published: true,
        body: `mixed-port: 7890
mode: rule
proxy-groups:
  - name: Auto-Best
    type: url-test
    interval: 300
  - name: Streaming
    type: select
    proxies: [HK-Kowloon, JP-Tokyo]`,
        draft: "",
      },
      {
        id: "tpl-minimal",
        name: "Minimal Direct",
        published: false,
        body: `mixed-port: 7890
mode: rule
rules:
  - GEOIP,CN,DIRECT
  - MATCH,Proxy`,
        draft: `mixed-port: 7890
mode: rule
ipv6: true
rules:
  - GEOIP,PRIVATE,DIRECT
  - GEOIP,CN,DIRECT
  - MATCH,Proxy`,
      },
    ],
    tasks: [
      {
        id: "op-8f2a9c10",
        kind: "upgrade",
        host: "host-jp",
        state: "running",
        step: 3,
        updated: t - 45 * 1000,
        error: "",
      },
      {
        id: "op-4c7d1e22",
        kind: "deploy",
        host: "host-hk",
        state: "succeeded",
        step: 5,
        updated: t - 2 * hour,
        error: "",
      },
      {
        id: "op-9b3e6f01",
        kind: "reapply",
        host: "host-us",
        state: "failed",
        step: 2,
        updated: t - 5 * hour,
        error: "SSH handshake timed out after 15s (64.112.44.107:22)",
      },
      {
        id: "op-1a5f8d44",
        kind: "detect",
        host: "host-de",
        state: "queued",
        step: 0,
        updated: t - 9 * hour,
        error: "",
      },
    ],
    alerts: [
      {
        id: "alert-1",
        code: "host-unreachable",
        message: "us-la-edge failed 3 consecutive SSH health probes.",
        first: t - 42 * 60 * 1000,
        last: t - 3 * 60 * 1000,
        seen: false,
        closed: null,
      },
      {
        id: "alert-2",
        code: "config-drift",
        message: "DE-Frankfurt remote config differs from platform state.",
        first: t - 3 * hour,
        last: t - 18 * 60 * 1000,
        seen: true,
        closed: null,
      },
      {
        id: "alert-3",
        code: "probe-recovered",
        message: "JP-Tokyo authenticated proxy probe returned healthy.",
        first: t - 12 * hour,
        last: t - 11 * hour,
        seen: true,
        closed: t - 11 * hour,
      },
    ],
  };
}

let store: State | null = null;
function getStore(): State {
  if (!store) store = createMockState();
  return store;
}

export function isMockEnabled(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mock") === "1") return true;
    if (params.get("mock") === "0") return false;
    return localStorage.getItem("jetyet-mock") === "1";
  } catch {
    return false;
  }
}

export function setMockEnabled(enabled: boolean) {
  try {
    localStorage.setItem("jetyet-mock", enabled ? "1" : "0");
    const url = new URL(window.location.href);
    url.searchParams.delete("mock");
    window.history.replaceState({}, "", url.toString());
  } catch {}
  if (enabled) store = createMockState();
}

export async function mockApi(
  path: string,
  method = "GET",
  body?: any,
): Promise<any> {
  const s = getStore();
  if (path === "session") return { username: "demo" };
  if (path === "login") return { username: body?.username || "demo" };
  if (path === "logout") return { ok: true };
  if (path === "state") {
    const t = now();
    s.workers = s.workers.map((w) => ({ ...w, at: t - 3000 }));
    return structuredClone(s);
  }
  if (path.startsWith("archive/")) {
    const kind = path.split("/")[1];
    const t = now();
    if (kind === "hosts")
      return [{ id: "arch-sg", name: "sg-jurong-old", created: t - 90 * day }];
    if (kind === "nodes")
      return [{ id: "arch-node-sg", name: "SG-Legacy", created: t - 88 * day }];
    return [{ id: "arch-user-1", name: "guest-01", created: t - 60 * day }];
  }
  if (path.endsWith("/fingerprint") && method === "POST") {
    return {
      fingerprint: "SHA256:9f8kL2xP4qR7vT1wN5mB8cZ3yH6jD0sA2eF4gU1iV8o",
    };
  }
  if (path.endsWith("/command") && method === "POST") {
    return {
      script: `#!/usr/bin/env bash\nset -euo pipefail\ncurl -fsSL https://get.hy2.sh/ | bash -s -- --version ${body?.version || "v2.6.1"}\nsystemctl enable --now hysteria-server`,
    };
  }
  if (path.endsWith("/links")) {
    const uid = path.split("/")[1];
    const origin = window.location.origin;
    return {
      default: `${origin}/sub/${uid}/default-demo-token`,
      templates: s.templates
        .filter((t) => t.published)
        .map((t) => ({
          id: t.id,
          url: `${origin}/sub/${uid}/${t.id}?token=demo`,
        })),
    };
  }
  if (path.endsWith("/logs")) {
    const t = now();
    return [
      { at: t - 120000, message: "Connecting to host via SSH…" },
      { at: t - 95000, message: "Verified host fingerprint and systemd unit." },
      { at: t - 60000, message: "Rendered Hysteria 2 config and reloaded service." },
      { at: t - 20000, message: "Authenticated proxy probe succeeded (24ms)." },
    ];
  }
  if (path.endsWith("/drift")) {
    return {
      desired: "listen: :443\nobfs:\n  type: salamander\nbandwidth:\n  up: 500 mbps\n  down: 500 mbps",
      observed: "listen: :443\nobfs:\n  type: salamander\nbandwidth:\n  up: 200 mbps\n  down: 200 mbps",
    };
  }
  if (path.endsWith("/preview") && method === "POST") {
    return {
      text: `# Rendered preview for mock user\n${body?.body || "mixed-port: 7890\nmode: rule"}\nproxies:\n  - name: HK-Kowloon\n    type: hysteria2\n    server: hk.edge.example.com\n    port: 443\n    password: "***"`,
    };
  }
  if (path.startsWith("history/")) {
    const t = now();
    const samples = Array.from({ length: 24 }, (_, i) => {
      const wave = Math.sin(i * 0.45) * 0.5 + 0.5;
      return {
        at: t - (23 - i) * hour,
        reachable: true,
        observations: 60,
        successes: i === 14 ? 59 : 60,
        inbound: Math.round((140 + wave * 360) * 1024 ** 2),
        outbound: Math.round((190 + (1 - wave) * 420) * 1024 ** 2),
        cpu: Math.round(22 + wave * 48),
        cpu_max: Math.round(35 + wave * 54),
        memory: Math.round(45 + wave * 22),
        disk: 38,
      };
    });
    return {
      resolution: "hour",
      samples,
      events: [
        {
          id: "ev-1",
          type: "probe.healthy",
          at: t - 2 * hour,
          data: '{"latency_ms":24,"version":"v2.6.1"}',
        },
        {
          id: "ev-2",
          type: "usage.checkpoint",
          at: t - 6 * hour,
          data: '{"delta_mib":1284}',
        },
      ],
    };
  }
  if (path.startsWith("alerts/") && method === "POST") {
    const [, id, action] = path.split("/");
    const a = s.alerts.find((x) => x.id === id);
    if (a) {
      if (action === "read") a.seen = true;
      if (action === "close") {
        a.seen = true;
        a.closed = now();
      }
    }
    return { ok: true };
  }
  if (path.startsWith("tasks/") && method === "POST") {
    const [, id, action] = path.split("/");
    const task = s.tasks.find((x) => x.id === id);
    if (task) {
      task.state = action === "cancel" ? "cancelled" : "running";
      task.updated = now();
      if (action === "retry") task.error = "";
    }
    return { ok: true };
  }
  if (path.startsWith("usage/") && path.endsWith("/reset")) {
    const id = path.split("/")[1];
    const target: Row | undefined =
      s.hosts.find((x) => x.id === id) || s.users.find((x) => x.id === id);
    if (target) {
      target.usage.inbound = 0;
      target.usage.outbound = 0;
      target.exhausted = false;
    }
    return { ok: true };
  }
  return { ok: true };
}
