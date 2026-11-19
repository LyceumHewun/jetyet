// Shared synthetic preview harness and workspace seeder; loopback only.
import { type ChildProcess, spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Server as SshServer } from "ssh2";
import { sample, usage } from "../src/server/accounting";
import type { Config } from "../src/server/config";
import { token } from "../src/server/crypto";
import { storage, strip } from "../src/server/db";
import { enqueue } from "../src/server/tasks";

export interface PreviewHarness {
  dir: string;
  config: Config;
  password: string;
  sshPort: number;
  server: ChildProcess;
  getStartupError: () => string;
  waitReady: (url: string) => Promise<void>;
  touchHeartbeats: () => void;
  close: () => Promise<void>;
}

/**
 * Starts a loopback SSH stub, executable mihomo stub, isolated SQLite config,
 * and the local Jetyet server process for non-destructive preview sessions.
 */
export async function startPreviewHarness(opts: {
  dirPrefix: string;
  origin: string;
  port: number;
  password?: string;
}): Promise<PreviewHarness> {
  const dir = await mkdtemp(join(tmpdir(), opts.dirPrefix));
  const configPath = join(dir, "config.json");
  const dbPath = join(dir, "data.sqlite");
  const mihomoStubPath = join(dir, "mihomo-stub.sh");
  const masterKey = randomBytes(32).toString("hex");
  const password = opts.password ?? randomBytes(20).toString("hex");

  await writeFile(mihomoStubPath, "#!/bin/sh\nexit 0\n");
  await chmod(mihomoStubPath, 0o755);

  const { privateKey: hostPrivateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const sshServer = new SshServer({ hostKeys: [hostPrivateKey] }, (client) => {
    client.on("error", () => {});
    client.on("authentication", (ctx) => ctx.reject());
  });
  sshServer.on("error", () => {});
  await new Promise<void>((resolveListen) => {
    sshServer.listen(0, "127.0.0.1", () => resolveListen());
  });
  const sshAddress = sshServer.address();
  const sshPort =
    typeof sshAddress === "object" && sshAddress ? sshAddress.port : 2222;

  const config: Config = {
    origin: opts.origin,
    listen: "127.0.0.1",
    port: opts.port,
    database: dbPath,
    masterKey,
    admin: { username: "admin", password },
    probeUrl: "https://example.com",
    hysteriaBinary: "hysteria",
    mihomoBinary: mihomoStubPath,
  };

  await writeFile(configPath, JSON.stringify(config));

  const server = spawn("bun", ["src/server/index.ts"], {
    env: { ...process.env, JETYET_CONFIG: configPath },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let startupError = "";
  server.stderr?.on("data", (chunk) => {
    startupError += chunk;
  });
  server.stdout?.resume();

  const exited = new Promise<void>((resolveExit) => {
    if (server.exitCode !== null) {
      resolveExit();
      return;
    }
    server.once("exit", () => resolveExit());
  });

  let closed = false;

  return {
    dir,
    config,
    password,
    sshPort,
    server,
    getStartupError: () => startupError,
    waitReady: async (url: string) => {
      for (let i = 0; i < 40; i++) {
        if (server.exitCode !== null) {
          throw Error(`Preview server exited early: ${startupError}`);
        }
        try {
          const res = await fetch(url);
          if (res.ok) return;
        } catch {
          await sleep(200);
        }
      }
      throw Error(
        `Preview server did not answer on ${url}: ${startupError}`,
      );
    },
    touchHeartbeats: () => {
      const s = storage(config);
      try {
        const now = Date.now();
        s.db
          .query("INSERT OR REPLACE INTO heartbeats(name,at) VALUES(?,?)")
          .run("monitor", now);
        s.db
          .query("INSERT OR REPLACE INTO heartbeats(name,at) VALUES(?,?)")
          .run("operations", now);
      } finally {
        s.db.close();
      }
    },
    close: async () => {
      if (closed) return;
      closed = true;
      sshServer.close();
      if (server.exitCode === null) server.kill();
      await exited;
      const base = resolve(tmpdir()) + sep + opts.dirPrefix;
      if (!resolve(dir).startsWith(base)) {
        throw Error("Unexpected temporary path");
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Seeds representative synthetic hosts, Hysteria 2 nodes, subscribers,
 * 24h traffic samples, queued/failed tasks, alerts, and worker heartbeats.
 */
export function seedPreviewWorkspace(
  config: Config,
  opts: {
    updateExistingTokyo?: boolean;
    includeUntrustedOsaka?: boolean;
    loopbackSshPort?: number;
  } = {},
) {
  const s = storage(config);
  try {
    const now = Date.now();

    let tokyo = opts.updateExistingTokyo ? s.list("host")[0] : undefined;
    if (tokyo) {
      s.put(
        "host",
        {
          ...strip(tokyo),
          reachable: true,
          cpu: 14.2,
          memory: 38.6,
          disk: 29.4,
          uptime: 432100,
          lastSeen: now,
        },
        undefined,
        tokyo.id,
      );
    } else {
      tokyo = s.put(
        "host",
        {
          name: "Tokyo-01",
          address: "198.51.100.10",
          port: 22,
          username: "root",
          authType: "key",
          enabled: true,
          fingerprint: "SHA256:PreviewOnlyTokyoHostKey0123456789ABCDEF",
          reachable: true,
          cpu: 14.2,
          memory: 38.6,
          disk: 29.4,
          uptime: 432100,
          lastSeen: now,
          quota: {
            limit: 500 * 1024 ** 3,
            direction: "both",
            reset: { kind: "monthly", day: 1, hour: 0 },
          },
          initialIn: 0,
          initialOut: 0,
        },
        { credential: "preview-only", passphrase: "" },
      );
      usage(s, tokyo);
      s.event(tokyo.id, "host.created", {});
    }
    s.db
      .query("UPDATE usage SET inbound=?,outbound=? WHERE id=?")
      .run(
        Math.round(78 * 1024 ** 3),
        Math.round(142 * 1024 ** 3),
        tokyo.id,
      );

    const frankfurt = s.put(
      "host",
      {
        name: "Frankfurt-02",
        address: "198.51.100.22",
        port: 22,
        username: "root",
        authType: "key",
        enabled: true,
        fingerprint: "SHA256:PreviewOnlyFrankfurtKey0123456789ABCDEF",
        reachable: true,
        cpu: 31.8,
        memory: 64.5,
        disk: 48.1,
        uptime: 1296000,
        lastSeen: now,
        quota: {
          limit: 1024 ** 4,
          direction: "both",
          reset: { kind: "monthly", day: 1, hour: 0 },
        },
        initialIn: 0,
        initialOut: 0,
      },
      { credential: "preview-only", passphrase: "" },
    );
    usage(s, frankfurt);
    s.db
      .query("UPDATE usage SET inbound=?,outbound=? WHERE id=?")
      .run(
        Math.round(240 * 1024 ** 3),
        Math.round(645 * 1024 ** 3),
        frankfurt.id,
      );
    s.event(frankfurt.id, "host.created", {});

    if (opts.includeUntrustedOsaka && opts.loopbackSshPort) {
      const osaka = s.put(
        "host",
        {
          name: "Osaka-03",
          address: "127.0.0.1",
          port: opts.loopbackSshPort,
          username: "root",
          authType: "password",
          enabled: true,
          fingerprint: "",
          reachable: false,
          cpu: 0,
          memory: 0,
          disk: 0,
          quota: {
            limit: 500 * 1024 ** 3,
            direction: "both",
            reset: { kind: "monthly", day: 1, hour: 0 },
          },
          initialIn: 0,
          initialOut: 0,
        },
        { credential: "preview-only", passphrase: "" },
      );
      usage(s, osaka);
      s.event(osaka.id, "host.created", {});
    }

    const oldHost = s.put(
      "host",
      {
        name: "Archive-Singapore",
        address: "198.51.100.99",
        port: 22,
        username: "root",
        authType: "key",
        enabled: false,
        fingerprint: "SHA256:PreviewArchivedHostKey",
        quota: {
          limit: 500 * 1024 ** 3,
          direction: "both",
          reset: { kind: "monthly", day: 1, hour: 0 },
        },
      },
      { credential: "archived", passphrase: "" },
    );
    usage(s, oldHost);
    s.db.query("UPDATE entities SET deleted=1 WHERE id=?").run(oldHost.id);

    for (let i = 24; i >= 0; i--) {
      const at = now - i * 3600000;
      const wave = Math.sin(i / 3) * 0.5 + 0.5;
      sample(
        s,
        tokyo.id,
        at,
        Math.round((45 + wave * 80) * 1024 ** 2),
        Math.round((95 + wave * 140) * 1024 ** 2),
        {
          reachable: 1,
          cpu: 12 + wave * 24,
          memory: 36 + wave * 10,
          disk: 29.4,
        },
      );
      sample(
        s,
        frankfurt.id,
        at,
        Math.round((80 + wave * 110) * 1024 ** 2),
        Math.round((180 + wave * 210) * 1024 ** 2),
        {
          reachable: 1,
          cpu: 24 + wave * 35,
          memory: 58 + wave * 12,
          disk: 48.1,
        },
      );
    }

    const template = s.list("template")[0];
    const user1Id = crypto.randomUUID();
    const user2Id = crypto.randomUUID();

    const nodeFrankfurt = s.put(
      "node",
      {
        hostId: frankfurt.id,
        name: "DE · Frankfurt",
        address: "203.0.113.22",
        port: 443,
        hopping: "20000-50000",
        hopInterval: 30,
        upMbps: 200,
        downMbps: 500,
        enabled: true,
        status: "ready",
        service: true,
        probe: "healthy",
        probed: now - 45000,
        version: "v2.6.5",
        drift: false,
        online: { [user1Id]: 2, [user2Id]: 1 },
      },
      { authSecret: token(), statsSecret: token(), probeToken: token() },
    );

    const existingTokyoNode = opts.updateExistingTokyo
      ? s.list("node").find((n) => n.id !== nodeFrankfurt.id)
      : undefined;

    const nodeTokyo = existingTokyoNode
      ? s.put(
          "node",
          {
            ...strip(existingTokyoNode),
            name: "JP · Tokyo",
            status: "ready",
            service: true,
            probe: "healthy",
            probed: now - 55000,
            version: "v2.6.4",
            drift: true,
            online: { [user1Id]: 1 },
          },
          undefined,
          existingTokyoNode.id,
        )
      : s.put(
          "node",
          {
            hostId: tokyo.id,
            name: "JP · Tokyo",
            address: "203.0.113.10",
            port: 443,
            hopping: "30000-45000",
            hopInterval: 30,
            upMbps: 150,
            downMbps: 400,
            enabled: true,
            status: "ready",
            service: true,
            probe: "healthy",
            probed: now - 55000,
            version: "v2.6.4",
            drift: true,
            online: { [user1Id]: 1 },
          },
          { authSecret: token(), statsSecret: token(), probeToken: token() },
        );

    const assignedNodes = [nodeFrankfurt.id, nodeTokyo.id];

    const alex = s.put(
      "user",
      {
        name: "Alex",
        note: "Laptop & phone",
        enabled: true,
        expires: null,
        quota: {
          limit: 120 * 1024 ** 3,
          direction: "both",
          reset: { kind: "monthly", day: 1, hour: 0 },
        },
        nodeIds: assignedNodes,
        templateIds: template ? [template.id] : [],
        defaultTemplate: template?.id || "",
      },
      { vpnToken: token(), subscriptionToken: token() },
      user1Id,
    );
    usage(s, alex);
    s.db
      .query("UPDATE usage SET inbound=?,outbound=? WHERE id=?")
      .run(Math.round(14 * 1024 ** 3), Math.round(32 * 1024 ** 3), alex.id);

    const maya = s.put(
      "user",
      {
        name: "Maya",
        note: "Shared iPad",
        enabled: true,
        expires: new Date(now + 14 * 86400000).toISOString(),
        quota: {
          limit: 60 * 1024 ** 3,
          direction: "out",
          reset: {
            kind: "interval",
            days: 30,
            anchor: new Date(now).toISOString(),
          },
        },
        nodeIds: [nodeFrankfurt.id],
        templateIds: template ? [template.id] : [],
        defaultTemplate: template?.id || "",
      },
      { vpnToken: token(), subscriptionToken: token() },
      user2Id,
    );
    usage(s, maya);
    s.db
      .query("UPDATE usage SET inbound=?,outbound=? WHERE id=?")
      .run(Math.round(8 * 1024 ** 3), Math.round(62 * 1024 ** 3), maya.id);

    const sam = s.put(
      "user",
      {
        name: "Sam",
        note: "Travel spare",
        enabled: true,
        expires: null,
        quota: {
          limit: null,
          direction: "both",
          reset: { kind: "monthly", day: 15, hour: 0 },
        },
        nodeIds: assignedNodes,
        templateIds: template ? [template.id] : [],
        defaultTemplate: template?.id || "",
      },
      { vpnToken: token(), subscriptionToken: token() },
    );
    usage(s, sam);
    s.db
      .query("UPDATE usage SET inbound=?,outbound=? WHERE id=?")
      .run(Math.round(3 * 1024 ** 3), Math.round(9 * 1024 ** 3), sam.id);

    const okTaskId = enqueue(s, frankfurt.id, "deploy", {
      nodeId: nodeFrankfurt.id,
      version: "v2.6.5",
    });
    s.db
      .query("UPDATE tasks SET state='succeeded',step=3,updated=? WHERE id=?")
      .run(now - 60000, okTaskId);
    s.db
      .query("INSERT INTO task_logs(task,message,at) VALUES(?,?,?)")
      .run(
        okTaskId,
        "Verified Hysteria 2 v2.6.5 binary and systemd unit",
        now - 60000,
      );

    const failTaskId = enqueue(s, tokyo.id, "upgrade", {
      nodeId: nodeTokyo.id,
      version: "v2.6.5",
    });
    s.db
      .query(
        "UPDATE tasks SET state='failed',step=1,error=?,updated=? WHERE id=?",
      )
      .run("SSH handshake timed out during check", now - 180000, failTaskId);
    s.db
      .query("INSERT INTO task_logs(task,message,at) VALUES(?,?,?)")
      .run(
        failTaskId,
        "Connecting to 198.51.100.10:22 as root (preview simulation)",
        now - 180000,
      );

    s.db
      .query("INSERT OR REPLACE INTO heartbeats(name,at) VALUES(?,?)")
      .run("monitor", now);
    s.db
      .query("INSERT OR REPLACE INTO heartbeats(name,at) VALUES(?,?)")
      .run("operations", now);

    s.alert(
      nodeTokyo.id,
      "configuration-drift",
      "Remote config differs from desired platform settings on JP · Tokyo.",
    );
    s.alert(
      frankfurt.id,
      "ssh-unreachable",
      "Temporary SSH reachability blip observed during maintenance.",
    );
    s.resolveAlert(frankfurt.id, "ssh-unreachable");
    s.db.query("UPDATE alerts SET seen=1 WHERE closed IS NOT NULL").run();
  } finally {
    s.db.close();
  }
}
