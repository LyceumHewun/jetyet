import {
  addObservation,
  exhausted,
  nodeAllowed,
  nodeDelta,
  refreshPeriods,
  retention,
  sample,
  userAllowed,
} from "../server/accounting";
import { loadConfig } from "../server/config";
import { digest } from "../server/crypto";
import { storage, strip, type Entity, type Store } from "../server/db";
import { serverConfig } from "../server/deployment";
import { execute, statsApi, withHost } from "../server/ssh";
import { beat, claim, enqueue, finish } from "../server/tasks";
import { probeNode } from "./probe";

const hostScript = `set -euo pipefail
python3 - <<'PY'
import json,subprocess,time,os,hashlib
def read(p):
 with open(p) as f:return f.read().strip()
routes=[]
for family in ['-4','-6']:
 r=subprocess.run(['ip','-j',family,'route','show','default'],capture_output=True,text=True)
 if r.returncode==0: routes+=json.loads(r.stdout)
interfaces=set(r['dev'] for r in routes if 'dev' in r)
if not interfaces: raise Exception('No default-route interface found')
rx=tx=0
for name in interfaces:
 rx+=int(read('/sys/class/net/'+name+'/statistics/rx_bytes'));tx+=int(read('/sys/class/net/'+name+'/statistics/tx_bytes'))
cpu=list(map(int,read('/proc/stat').splitlines()[0].split()[1:9]))
mem={line.split(':')[0]:int(line.split()[1]) for line in read('/proc/meminfo').splitlines()}
disk=os.statvfs('/')
out={'inbound':rx,'outbound':tx,'boot':read('/proc/sys/kernel/random/boot_id'),'uptime':float(read('/proc/uptime').split()[0]),'cpuTotal':sum(cpu),'cpuIdle':cpu[3]+cpu[4],'memory':100*(1-mem.get('MemAvailable',mem['MemFree'])/mem['MemTotal']),'disk':100*(1-disk.f_bavail/disk.f_blocks)}
out['service']=subprocess.run(['systemctl','is-active','--quiet','jetyet-hysteria.service']).returncode==0
if os.path.exists('/etc/jetyet/manifest.json'):
 out['manifest']=json.loads(read('/etc/jetyet/manifest.json'))
 out['configHash']=hashlib.sha256(open('/etc/jetyet/config.yaml','rb').read()).hexdigest()
 out['config']=read('/etc/jetyet/config.yaml')
 out['serviceEpoch']=subprocess.run(['systemctl','show','--value','--property=InvocationID','jetyet-hysteria.service'],capture_output=True,text=True).stdout.strip()
print(json.dumps(out))
PY
`;

export async function collectHost(s: Store, h: Entity) {
  const at = Date.now(),
    n = s
      .list("node")
      .find((n) => n.hostId === h.id && !n.deleting && n.status !== "draft");
  try {
    const data = await withHost(s, h, (c) =>
      execute(c, hostScript, h.username !== "root", 30000).then(JSON.parse),
    );
    const totalDelta = data.cpuTotal - (h.cpuTotal ?? data.cpuTotal),
      idleDelta = data.cpuIdle - (h.cpuIdle ?? data.cpuIdle);
    const cpu =
      totalDelta > 0
        ? Math.max(0, Math.min(100, 100 * (1 - idleDelta / totalDelta)))
        : 0;
    s.db
      .transaction(() => {
        const delta = addObservation(
          s,
          h,
          `host:${h.id}`,
          data.boot,
          data.inbound,
          data.outbound,
          at,
        );
        sample(s, h.id, at, delta.inbound, delta.outbound, {
          cpu,
          memory: data.memory,
          disk: data.disk,
          reachable: 1,
        });
        const current = s.get(h.id)!;
        s.put(
          "host",
          {
            ...strip(current),
            lastSeen: at,
            reachable: true,
            uptime: data.uptime,
            cpu,
            memory: data.memory,
            disk: data.disk,
            cpuTotal: data.cpuTotal,
            cpuIdle: data.cpuIdle,
          },
          undefined,
          h.id,
        );
      })
      .immediate();
    s.resolveAlert(h.id, "unreachable");
    s.resolveAlert(h.id, "stale");
    if (n) {
      const drift =
        data.configHash !== digest(serverConfig(s, n)) ||
        data.manifest?.nodeId !== n.id ||
        data.manifest?.hopping !== n.hopping ||
        data.manifest?.port !== n.port;
      if (drift)
        s.alert(
          n.id,
          "drift",
          "Remote configuration differs from the platform configuration.",
        );
      else s.resolveAlert(n.id, "drift");
      const current = s.get(n.id)!;
      s.put(
        "node",
        { ...strip(current), service: data.service, drift, lastSeen: at },
        {
          ...s.secrets(n.id),
          observedConfig: typeof data.config === "string" ? data.config : "",
        },
        n.id,
      );
      if (data.service) {
        try {
          // /traffic tx is client upload (server inbound); rx is client download (server outbound).
          const traffic = (await statsApi(s, n, "/traffic")) as Record<
            string,
            { tx: number; rx: number }
          >;
          const online = await statsApi(s, n, "/online");
          s.db
            .transaction(() => {
              const totals = Object.values(traffic).reduce(
                (v, c) => ({
                  inbound: v.inbound + c.tx,
                  outbound: v.outbound + c.rx,
                }),
                { inbound: 0, outbound: 0 },
              );
              const total = nodeDelta(
                s,
                n.id,
                data.boot + ":" + data.serviceEpoch,
                totals.inbound,
                totals.outbound,
                at,
              );
              for (const [id, counter] of Object.entries(traffic)) {
                const user = s.get(id);
                if (!user || user.kind !== "user") continue;
                const delta = addObservation(
                  s,
                  user,
                  `node:${n.id}:user:${id}`,
                  data.boot + ":" + data.serviceEpoch,
                  counter.tx,
                  counter.rx,
                  at,
                );
                sample(s, id, at, delta.inbound, delta.outbound);
              }
              sample(s, n.id, at, total.inbound, total.outbound);
              const current = s.get(n.id)!;
              s.put(
                "node",
                { ...strip(current), online, trafficSeen: at },
                undefined,
                n.id,
              );
            })
            .immediate();
          s.resolveAlert(n.id, "stats");
        } catch {
          s.alert(
            n.id,
            "stats",
            "Traffic Stats API collection failed; host SSH remains reachable.",
          );
        }
      }
      if (!data.service && h.enabled && n.enabled)
        s.alert(n.id, "service", "Hysteria 2 service is not running.");
      else s.resolveAlert(n.id, "service");
    }
  } catch (error) {
    s.db
      .transaction(() => {
        sample(s, h.id, at, 0, 0, { reachable: 0 });
        const current = s.get(h.id);
        if (current && !current.deleted)
          s.put(
            "host",
            { ...strip(current), reachable: false },
            undefined,
            h.id,
          );
      })
      .immediate();
    s.alert(
      h.id,
      "unreachable",
      "SSH collection failed. Check reachability, host key, credentials and privileges.",
    );
  }
}
async function urgent(s: Store, owner: string) {
  for (let i = 0; i < 100; i++) {
    const task = claim(s, true, owner);
    if (!task) return;
    const p = JSON.parse(task.payload),
      n = s.get(p.nodeId);
    const timer = setInterval(
      () =>
        s.db
          .query("UPDATE tasks SET lease=? WHERE id=? AND owner=?")
          .run(Date.now() + 90000, task.id, owner),
      20000,
    );
    try {
      if (n && !n.deleted) {
        await statsApi(s, n, "/kick", p.userIds);
      }
      finish(s, task, "succeeded");
      if (n && !n.deleted) {
        const current = s.get(n.id)!;
        const online = { ...current.online };
        for (const id of p.userIds) delete online[id];
        s.put("node", { ...strip(current), online }, undefined, n.id);
      }
      if (
        !s.db
          .query(
            "SELECT id FROM tasks WHERE host=? AND kind='kick' AND state IN ('queued','running')",
          )
          .get(task.host)
      )
        s.resolveAlert(task.host, "kick-pending");
    } catch {
      s.db
        .query(
          "UPDATE tasks SET state='queued',owner=NULL,lease=?,error=?,updated=? WHERE id=? AND owner=?",
        )
        .run(
          Date.now() + 15000,
          "SSH disconnection pending",
          Date.now(),
          task.id,
          owner,
        );
      s.alert(
        task.host,
        "kick-pending",
        "Connection revocation is waiting for remote access.",
      );
      return;
    } finally {
      clearInterval(timer);
    }
  }
}
function enforce(s: Store) {
  for (const u of s.list("user")) {
    if (exhausted(s, u))
      s.alert(u.id, "quota", "User traffic allowance exhausted.");
    else s.resolveAlert(u.id, "quota");
    if (!userAllowed(s, u)) {
      for (const n of s.list("node"))
        if (n.online?.[u.id]) queueKick(s, n, [u.id]);
    }
  }
  for (const h of s.list("host")) {
    if (exhausted(s, h)) {
      s.alert(h.id, "quota", "VPS traffic allowance exhausted.");
      for (const n of s.list("node").filter((n) => n.hostId === h.id))
        queueKick(s, n, Object.keys(n.online || {}));
    } else s.resolveAlert(h.id, "quota");
    if (h.lastSeen && Date.now() - h.lastSeen > 180000)
      s.alert(
        h.id,
        "stale",
        "Traffic observations are stale; authentication uses last known usage.",
      );
  }
}
function queueKick(s: Store, n: Entity, ids: string[]) {
  if (!ids.length) return;
  const pending = s.db
    .query(
      "SELECT id FROM tasks WHERE host=? AND kind='kick' AND state IN ('queued','running') AND payload=?",
    )
    .get(n.hostId, JSON.stringify({ nodeId: n.id, userIds: ids }));
  if (!pending) enqueue(s, n.hostId, "kick", { nodeId: n.id, userIds: ids });
}
async function pool<T>(
  values: T[],
  limit: number,
  fn: (v: T) => Promise<void>,
) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (cursor < values.length) {
        const v = values[cursor++];
        await fn(v);
      }
    }),
  );
}
if (import.meta.main) {
  const s = storage(loadConfig(false)),
    owner = crypto.randomUUID();
  let stopping = false,
    collecting = false,
    probing = false,
    kicking = false,
    lastCollect = 0,
    lastProbe = 0,
    lastRetention = 0;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  const hb = setInterval(() => beat(s, "monitor"), 10000);
  beat(s, "monitor");
  while (!stopping) {
    refreshPeriods(s);
    enforce(s);
    if (!kicking) {
      kicking = true;
      void urgent(s, owner).finally(() => {
        kicking = false;
      });
    }
    if (Date.now() - lastCollect >= 60000 && !collecting) {
      lastCollect = Date.now();
      collecting = true;
      void pool(
        s.list("host").filter((h) => h.fingerprint && !h.deleting),
        5,
        (h) => collectHost(s, h),
      ).finally(() => {
        collecting = false;
      });
    }
    if (Date.now() - lastProbe >= 300000 && !probing) {
      lastProbe = Date.now();
      probing = true;
      void pool(
        s.list("node").filter((n) => n.status === "ready" && nodeAllowed(s, n)),
        3,
        async (n) => {
          try {
            await probeNode(s, n);
            s.resolveAlert(n.id, "probe");
            const current = s.get(n.id);
            if (current && !current.deleted)
              s.put(
                "node",
                { ...strip(current), probe: "healthy", probed: Date.now() },
                undefined,
                n.id,
              );
          } catch {
            s.alert(n.id, "probe", "Authenticated proxy HTTPS probe failed.");
            const current = s.get(n.id);
            if (current && !current.deleted)
              s.put(
                "node",
                { ...strip(current), probe: "failed", probed: Date.now() },
                undefined,
                n.id,
              );
          }
        },
      ).finally(() => {
        probing = false;
      });
    }
    if (Date.now() - lastRetention > 3600000) {
      retention(s);
      lastRetention = Date.now();
    }
    await Bun.sleep(1000);
  }
  while (collecting || probing || kicking) await Bun.sleep(100);
  clearInterval(hb);
  s.db.close();
}
