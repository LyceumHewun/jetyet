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
import { loadWorkerConfig } from "../server/config";
import { digest } from "../server/crypto";
import { storage, strip, type Entity, type Store } from "../server/db";
import {
  echKeysParserPy,
  nodeVerifiedRevision,
  serverConfig,
} from "../server/deployment";
import { execute, statsApi, withHost } from "../server/ssh";
import { beat, claim, enqueue, finish, type Task } from "../server/tasks";
import { probeNode } from "./probe";

const hostScript = `set -euo pipefail
python3 - <<'PY'
import base64,json,struct,subprocess,time,os,hashlib,re
${echKeysParserPy}
def read(p):
 with open(p) as f:return f.read().strip()
routes=[]
for family in ['-4','-6']:
 r=subprocess.run(['ip','-j',family,'route','show','default'],capture_output=True,text=True)
 if r.returncode==0: routes+=json.loads(r.stdout)
all_ifaces=set(r['dev'] for r in routes if 'dev' in r)
if not all_ifaces: raise Exception('No default-route interface found')
excluded=('tun','tap','wg','sit','ip6tnl','gif','docker','veth','br-','tailscale')
filtered={n for n in all_ifaces if not (n=='lo' or any(n.startswith(p) for p in excluded))}
interfaces=filtered if filtered else all_ifaces
rx=tx=0
for name in sorted(interfaces):
 rx+=int(read('/sys/class/net/'+name+'/statistics/rx_bytes'));tx+=int(read('/sys/class/net/'+name+'/statistics/tx_bytes'))
cpu=list(map(int,read('/proc/stat').splitlines()[0].split()[1:9]))
mem={line.split(':')[0]:int(line.split()[1]) for line in read('/proc/meminfo').splitlines()}
disk=os.statvfs('/')
out={'inbound':rx,'outbound':tx,'ifaceEpoch':','.join(sorted(interfaces)),'boot':read('/proc/sys/kernel/random/boot_id'),'uptime':float(read('/proc/uptime').split()[0]),'cpuTotal':sum(cpu),'cpuIdle':cpu[3]+cpu[4],'memory':100*(1-mem.get('MemAvailable',mem['MemFree'])/mem['MemTotal']),'disk':100*(1-disk.f_bavail/disk.f_blocks)}
out['service']=subprocess.run(['systemctl','is-active','--quiet','jetyet-hysteria.service']).returncode==0
if os.path.exists('/etc/jetyet/manifest.json'):
 out['manifest']=json.loads(read('/etc/jetyet/manifest.json'))
 if os.path.exists('/etc/jetyet/config.yaml'):
  out['configHash']=hashlib.sha256(open('/etc/jetyet/config.yaml','rb').read()).hexdigest()
  out['config']=read('/etc/jetyet/config.yaml')
 else:
  out['configHash']=None
  out['config']=''
 if os.path.exists('/etc/jetyet/server.crt'):
  r=subprocess.run(['openssl','x509','-in','/etc/jetyet/server.crt','-outform','DER'],capture_output=True)
  if r.returncode==0: out['certSha256']=hashlib.sha256(r.stdout).hexdigest()
 if os.path.exists('/etc/jetyet/ech.pem'):
  parsed=parse_ech_keys_file('/etc/jetyet/ech.pem')
  if parsed: out['echConfig']=parsed['echConfig']
 out['serviceEpoch']=subprocess.run(['systemctl','show','--value','--property=InvocationID','jetyet-hysteria.service'],capture_output=True,text=True).stdout.strip()
print(json.dumps(out))
PY
`;

const isStaleTime = (last: number | undefined, created: number, now: number) =>
  now - (last || created) > 180000;

function isUserStale(
  u: Entity,
  nodes: Entity[],
  hostsById: Map<string, Entity>,
  now: number,
) {
  return (
    !u.deleted &&
    !u.deleting &&
    u.enabled &&
    nodes.some((n) => {
      if (
        !u.nodeIds.includes(n.id) ||
        !n.enabled ||
        n.status !== "ready" ||
        n.deleting ||
        n.service === false
      )
        return false;
      const h = hostsById.get(n.hostId);
      return (
        !!h &&
        !h.deleted &&
        !h.deleting &&
        h.enabled &&
        !!h.fingerprint &&
        isStaleTime(n.trafficSeen, n.created, now)
      );
    })
  );
}

export async function collectHost(
  s: Store,
  h: Entity,
  runner?: (script: string) => Promise<string>,
) {
  const at = Date.now(),
    n = s
      .list("node")
      .find((n) => n.hostId === h.id && !n.deleting && n.status !== "draft");
  try {
    const initialRevision = n ? nodeVerifiedRevision(s, n, h) : null;
    const activeOpBefore = !!s.db
      .query<{ id: string }, [string]>(
        "SELECT id FROM tasks WHERE host=? AND kind!='kick' AND state='running' LIMIT 1",
      )
      .get(h.id);
    const data = runner
      ? JSON.parse(await runner(hostScript))
      : await withHost(s, h, (c) =>
          execute(c, hostScript, h.username !== "root", 30000).then(JSON.parse),
        );
    const totalDelta = data.cpuTotal - (h.cpuTotal ?? data.cpuTotal),
      idleDelta = data.cpuIdle - (h.cpuIdle ?? data.cpuIdle);
    const cpu =
      totalDelta > 0
        ? Math.max(0, Math.min(100, 100 * (1 - idleDelta / totalDelta)))
        : 0;
    const hostEpoch = data.ifaceEpoch
      ? `${data.boot}:${data.ifaceEpoch}`
      : data.boot;
    s.db
      .transaction(() => {
        const delta = addObservation(
          s,
          h,
          `host:${h.id}`,
          hostEpoch,
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
      const current = s.get(n.id);
      const latestHost = s.get(h.id);
      const activeOpAfter = !!s.db
        .query<{ id: string }, [string]>(
          "SELECT id FROM tasks WHERE host=? AND kind!='kick' AND state='running' LIMIT 1",
        )
        .get(h.id);
      const revisionChanged =
        !current ||
        current.deleted ||
        current.deleting ||
        !latestHost ||
        latestHost.deleted ||
        nodeVerifiedRevision(s, current, latestHost) !== initialRevision;
      if (current && !current.deleted && !current.deleting) {
        if (!activeOpBefore && !activeOpAfter && !revisionChanged) {
          const incompleteInstall = data.manifest?.phase !== "ready";
          const pinnedDrift =
            current.tlsSecurity === "pinned" &&
            (data.manifest?.tlsSecurity !== "pinned" ||
              data.manifest?.sni !== current.sni ||
              (current.certSha256 && data.certSha256 !== current.certSha256));
          const echDrift =
            current.ech === true &&
            (data.manifest?.ech !== true ||
              data.manifest?.echPublicName !== current.echPublicName ||
              (current.echConfig && data.echConfig !== current.echConfig));
          const drift =
            incompleteInstall ||
            data.configHash !== digest(serverConfig(s, current)) ||
            data.manifest?.nodeId !== current.id ||
            data.manifest?.hopping !== current.hopping ||
            data.manifest?.port !== current.port ||
            pinnedDrift ||
            echDrift;
          if (drift)
            s.alert(
              current.id,
              "drift",
              incompleteInstall
                ? "Remote deployment is incomplete and differs from the platform configuration."
                : "Remote configuration differs from the platform configuration.",
            );
          else s.resolveAlert(current.id, "drift");
          s.put(
            "node",
            {
              ...strip(current),
              service: data.service,
              drift,
              lastSeen: at,
              ...(data.service ? {} : { online: {} }),
            },
            {
              ...s.secrets(current.id),
              observedConfig:
                typeof data.config === "string" ? data.config : "",
            },
            current.id,
          );
        } else {
          s.put(
            "node",
            {
              ...strip(current),
              service: data.service,
              lastSeen: at,
              ...(data.service ? {} : { online: {} }),
            },
            undefined,
            current.id,
          );
        }
      }
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
          const now = Date.now();
          const nodes = s.list("node");
          const hostsById = new Map(
            s.list("host").map((host) => [host.id, host]),
          );
          for (const u of s.list("user")) {
            if (
              u.nodeIds.includes(n.id) &&
              !isUserStale(u, nodes, hostsById, now)
            )
              s.resolveAlert(u.id, "stale");
          }
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
  for (let round = 0; round < 20; round++) {
    const batch: Task[] = [];
    for (let i = 0; i < 5; i++) {
      const task = claim(s, true, owner);
      if (!task) break;
      batch.push(task);
    }
    if (!batch.length) return;
    let progressed = false;
    await pool(batch, 5, async (task) => {
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
        if (
          n &&
          !n.deleted &&
          !n.deleting &&
          n.status === "ready" &&
          n.service !== false
        ) {
          await statsApi(s, n, "/kick", p.userIds);
        }
        finish(s, task, "succeeded");
        progressed = true;
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
      } finally {
        clearInterval(timer);
      }
    });
    if (!progressed) return;
  }
}
function enforce(s: Store) {
  const now = Date.now();
  const hostsById = new Map(s.list("host").map((h) => [h.id, h]));
  const nodes = s.list("node");
  for (const u of s.list("user")) {
    if (exhausted(s, u))
      s.alert(u.id, "quota", "User traffic allowance exhausted.");
    else s.resolveAlert(u.id, "quota");
    if (!userAllowed(s, u)) {
      for (const n of nodes) if (n.online?.[u.id]) queueKick(s, n, [u.id]);
    }
    if (isUserStale(u, nodes, hostsById, now))
      s.alert(
        u.id,
        "stale",
        "Traffic observations are stale; authentication uses last known usage.",
      );
    else s.resolveAlert(u.id, "stale");
  }
  for (const h of hostsById.values()) {
    if (exhausted(s, h)) {
      s.alert(h.id, "quota", "VPS traffic allowance exhausted.");
      for (const n of nodes.filter((n) => n.hostId === h.id))
        queueKick(s, n, Object.keys(n.online || {}));
    } else s.resolveAlert(h.id, "quota");
    if (
      !h.deleting &&
      !!h.fingerprint &&
      h.enabled &&
      isStaleTime(h.lastSeen, h.created, now)
    )
      s.alert(
        h.id,
        "stale",
        "Traffic observations are stale; authentication uses last known usage.",
      );
    else s.resolveAlert(h.id, "stale");
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
  const s = storage(await loadWorkerConfig()),
    owner = crypto.randomUUID();
  let stopping = false,
    collecting = false,
    probing = false,
    kicking = false,
    lastCollect = 0,
    lastProbe = 0,
    lastRetention = 0;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
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
