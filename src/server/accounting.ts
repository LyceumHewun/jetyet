import { DateTime } from "luxon";
import type { Quota, Reset } from "../shared/schemas";
import type { Entity, Store } from "./db";

export function nextReset(policy: Reset, after: number): number {
  const time = DateTime.fromMillis(after, { zone: "Asia/Hong_Kong" });
  if (policy.kind === "interval") {
    const anchor = DateTime.fromISO(policy.anchor, {
      setZone: true,
    }).toMillis();
    return (
      anchor +
      Math.max(0, Math.floor((after - anchor) / (policy.days * 86400000)) + 1) *
        policy.days *
        86400000
    );
  }
  let month = time.startOf("month");
  for (let i = 0; i < 2; i++, month = month.plus({ months: 1 })) {
    const candidate = month.set({
      day: Math.min(policy.day, month.daysInMonth!),
      hour: policy.hour,
    });
    if (candidate.toMillis() > after) return candidate.toMillis();
  }
  throw Error("Invalid monthly reset");
}
export type Usage = {
  id: string;
  inbound: number;
  outbound: number;
  start: number;
  next: number;
};
export function usage(s: Store, e: Entity): Usage {
  let row = s.db
    .query<Usage, [string]>("SELECT * FROM usage WHERE id=?")
    .get(e.id);
  if (!row) {
    const now = Date.now();
    s.db
      .query("INSERT INTO usage VALUES(?,?,?,?,?)")
      .run(
        e.id,
        e.initialIn || 0,
        e.initialOut || 0,
        now,
        nextReset(e.quota.reset, now),
      );
    row = s.db
      .query<Usage, [string]>("SELECT * FROM usage WHERE id=?")
      .get(e.id)!;
  }
  return row;
}
export function counted(q: Quota, u: Pick<Usage, "inbound" | "outbound">) {
  return q.direction === "in"
    ? u.inbound
    : q.direction === "out"
      ? u.outbound
      : u.inbound + u.outbound;
}
export function exhausted(s: Store, e: Entity) {
  return (
    e.quota.limit !== null && counted(e.quota, usage(s, e)) >= e.quota.limit
  );
}
export function resetUsage(s: Store, e: Entity, manual: boolean) {
  const u = usage(s, e),
    now = Date.now();
  if (!manual && u.next > now) return;
  const start = manual ? now : previousBoundary(e.quota.reset, now, u.next);
  s.event(e.id, manual ? "traffic.manual-reset" : "traffic.scheduled-reset", {
    before: u,
    start,
    policy: e.quota.reset,
  });
  s.db
    .query("UPDATE usage SET inbound=0,outbound=0,start=?,next=? WHERE id=?")
    .run(start, manual ? u.next : nextReset(e.quota.reset, now), e.id);
}
function previousBoundary(p: Reset, now: number, first: number) {
  if (p.kind === "interval")
    return (
      first +
      Math.floor((now - first) / (p.days * 86400000)) * p.days * 86400000
    );
  const t = DateTime.fromMillis(now, { zone: "Asia/Hong_Kong" });
  const m = t.startOf("month");
  const d = m.set({ day: Math.min(p.day, m.daysInMonth!), hour: p.hour });
  if (+d <= now) return +d;
  const prev = m.minus({ months: 1 });
  return +prev.set({ day: Math.min(p.day, prev.daysInMonth!), hour: p.hour });
}
export function refreshPeriods(s: Store) {
  const pending = (now: number) =>
    s.db
      .query<{ id: string }, [number]>(
        `SELECT u.id FROM usage u JOIN entities e ON e.id=u.id
        WHERE u.next<=? AND e.deleted=0 AND e.kind IN ('host','user')
        UNION ALL
        SELECT e.id FROM entities e
        WHERE e.deleted=0 AND e.kind IN ('host','user')
          AND NOT EXISTS (SELECT 1 FROM usage u WHERE u.id=e.id)`,
      )
      .all(now);
  // Current periods can be served while another process holds the write lock.
  if (!pending(Date.now()).length) return;
  s.db
    .transaction(() => {
      for (const { id } of pending(Date.now())) {
        const e = s.get(id)!;
        if (usage(s, e).next <= Date.now()) resetUsage(s, e, false);
      }
    })
    .immediate();
}
export function userAllowed(s: Store, user: Entity) {
  return (
    !user.deleted &&
    user.enabled &&
    (!user.expires || Date.parse(user.expires) > Date.now()) &&
    !exhausted(s, user)
  );
}
export function nodeAllowed(s: Store, node: Entity) {
  const host = s.get(node.hostId);
  return (
    !node.deleted &&
    node.status === "ready" &&
    node.enabled &&
    !node.deleting &&
    host &&
    !host.deleted &&
    host.enabled &&
    !host.deleting &&
    !exhausted(s, host)
  );
}
export function addObservation(
  s: Store,
  e: Entity,
  source: string,
  epoch: string,
  inbound: number,
  outbound: number,
  at = Date.now(),
) {
  if (![inbound, outbound].every((n) => Number.isSafeInteger(n) && n >= 0))
    throw Error("Invalid traffic counter");
  const prev = s.db
    .query<
      { epoch: string; inbound: number; outbound: number; at: number },
      [string]
    >("SELECT * FROM counters WHERE source=?")
    .get(source);
  if (prev && at < prev.at) return { inbound: 0, outbound: 0 };
  let din = 0,
    dout = 0;
  const u = usage(s, e);
  if (
    prev &&
    prev.epoch === epoch &&
    inbound >= prev.inbound &&
    outbound >= prev.outbound
  ) {
    if (at < u.start || prev.at < u.start) {
      if (inbound !== prev.inbound || outbound !== prev.outbound) {
        s.event(e.id, "traffic.gap", {
          from: prev.at,
          to: at,
          reason: "Unsplit counters across accounting boundary",
          measuredInbound: inbound - prev.inbound,
          measuredOutbound: outbound - prev.outbound,
        });
        s.alert(
          e.id,
          "accounting-gap",
          "Traffic crossed a reset boundary without sufficient observations.",
        );
      }
    } else {
      din = inbound - prev.inbound;
      dout = outbound - prev.outbound;
    }
  } else if (prev) {
    s.event(e.id, "traffic.gap", {
      from: prev.at,
      to: at,
      reason: "Counter epoch changed or counters rolled back",
    });
    s.alert(
      e.id,
      "accounting-gap",
      "Traffic counters changed epoch; missing traffic was not estimated.",
    );
  } else if (source.startsWith("node:")) {
    const reset = s.db
      .query(
        "SELECT id FROM events WHERE entity=? AND type IN ('traffic.manual-reset','traffic.scheduled-reset') LIMIT 1",
      )
      .get(e.id);
    const match = /^node:([^:]+):user:(.+)$/.exec(source);
    const first = match
      ? s.db
          .query<{ at: number }, [string, string]>(
            "SELECT at FROM first_auth WHERE node=? AND user=?",
          )
          .get(match[1], e.id)
      : null;
    if (inbound === 0 && outbound === 0) {
      din = 0;
      dout = 0;
    } else if (!reset || (first && first.at >= u.start && at >= u.start)) {
      din = inbound;
      dout = outbound;
    } else {
      s.event(e.id, "traffic.gap", {
        to: at,
        reason: "First node observation after an accounting reset",
      });
      s.alert(
        e.id,
        "accounting-gap",
        "Initial node counters cannot be attributed reliably across a reset.",
      );
    }
  }
  s.db
    .query(
      "INSERT INTO counters VALUES(?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET epoch=excluded.epoch,inbound=excluded.inbound,outbound=excluded.outbound,at=excluded.at",
    )
    .run(source, epoch, inbound, outbound, at);
  s.db
    .query("UPDATE usage SET inbound=inbound+?,outbound=outbound+? WHERE id=?")
    .run(din, dout, e.id);
  return { inbound: din, outbound: dout };
}
export function sample(
  s: Store,
  entity: string,
  at: number,
  inbound: number,
  outbound: number,
  metrics: Record<string, number | null> = {},
  trafficAvailable = true,
) {
  s.db
    .query(
      `INSERT INTO samples(entity,at,inbound,outbound,cpu,memory,disk,reachable,cpu_max,memory_max,disk_max,observations,successes,metric_count,traffic_available) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(entity,at,resolution) DO UPDATE SET inbound=samples.inbound+excluded.inbound,outbound=samples.outbound+excluded.outbound,traffic_available=MAX(samples.traffic_available,excluded.traffic_available),cpu=CASE WHEN samples.metric_count+excluded.metric_count>0 THEN (COALESCE(samples.cpu,0)*samples.metric_count+COALESCE(excluded.cpu,0)*excluded.metric_count)/(samples.metric_count+excluded.metric_count) ELSE NULL END,memory=CASE WHEN samples.metric_count+excluded.metric_count>0 THEN (COALESCE(samples.memory,0)*samples.metric_count+COALESCE(excluded.memory,0)*excluded.metric_count)/(samples.metric_count+excluded.metric_count) ELSE NULL END,disk=CASE WHEN samples.metric_count+excluded.metric_count>0 THEN (COALESCE(samples.disk,0)*samples.metric_count+COALESCE(excluded.disk,0)*excluded.metric_count)/(samples.metric_count+excluded.metric_count) ELSE NULL END,reachable=CAST(samples.successes+excluded.successes AS REAL)/NULLIF(samples.observations+excluded.observations,0),observations=samples.observations+excluded.observations,successes=samples.successes+excluded.successes,metric_count=samples.metric_count+excluded.metric_count,cpu_max=CASE WHEN samples.cpu_max IS NULL AND excluded.cpu_max IS NULL THEN NULL ELSE MAX(COALESCE(samples.cpu_max,0),COALESCE(excluded.cpu_max,0)) END,memory_max=CASE WHEN samples.memory_max IS NULL AND excluded.memory_max IS NULL THEN NULL ELSE MAX(COALESCE(samples.memory_max,0),COALESCE(excluded.memory_max,0)) END,disk_max=CASE WHEN samples.disk_max IS NULL AND excluded.disk_max IS NULL THEN NULL ELSE MAX(COALESCE(samples.disk_max,0),COALESCE(excluded.disk_max,0)) END`,
    )
    .run(
      entity,
      Math.floor(at / 60000) * 60000,
      inbound,
      outbound,
      metrics.cpu ?? null,
      metrics.memory ?? null,
      metrics.disk ?? null,
      metrics.reachable ?? null,
      metrics.cpu ?? null,
      metrics.memory ?? null,
      metrics.disk ?? null,
      metrics.reachable === undefined || metrics.reachable === null ? 0 : 1,
      metrics.reachable === 1 ? 1 : 0,
      metrics.cpu === undefined || metrics.cpu === null ? 0 : 1,
      Number(trafficAvailable),
    );
}
export function retention(s: Store) {
  const now = Date.now();
  s.db
    .transaction(() => {
      for (const [from, to, bucket, age] of [
        ["minute", "hour", 3600000, 30 * 86400000],
        ["hour", "day", 86400000, 365 * 86400000],
      ] as const) {
        const cutoff = Math.floor((now - age) / bucket) * bucket;
        s.db
          .query(
            `INSERT INTO samples(entity,at,inbound,outbound,resolution,cpu,memory,disk,reachable,cpu_max,memory_max,disk_max,observations,successes,metric_count,traffic_available)
        SELECT entity,CAST(at/? AS INTEGER)*?,SUM(inbound),SUM(outbound),?,SUM(cpu*metric_count)/NULLIF(SUM(metric_count),0),SUM(memory*metric_count)/NULLIF(SUM(metric_count),0),SUM(disk*metric_count)/NULLIF(SUM(metric_count),0),CAST(SUM(successes) AS REAL)/NULLIF(SUM(observations),0),MAX(cpu_max),MAX(memory_max),MAX(disk_max),SUM(observations),SUM(successes),SUM(metric_count),MAX(traffic_available) FROM samples WHERE resolution=? AND at<? GROUP BY entity,CAST(at/? AS INTEGER)
        ON CONFLICT(entity,at,resolution) DO NOTHING`,
          )
          .run(bucket, bucket, to, from, cutoff, bucket);
        s.db
          .query("DELETE FROM samples WHERE resolution=? AND at<?")
          .run(from, cutoff);
      }
      s.db.query("DELETE FROM task_logs WHERE at<?").run(now - 90 * 86400000);
      s.db
        .query("DELETE FROM alerts WHERE closed IS NOT NULL AND closed<?")
        .run(now - 90 * 86400000);
      s.db.query("DELETE FROM sessions WHERE expires<?").run(now);
      s.db.query("DELETE FROM portal_sessions WHERE expires<?").run(now);
      s.db.query("DELETE FROM portal_password_links WHERE expires<?").run(now);
      s.db.query("DELETE FROM login_limits WHERE reset<?").run(now);
    })
    .immediate();
}

export function nodeDelta(
  s: Store,
  nodeId: string,
  epoch: string,
  inbound: number,
  outbound: number,
  at: number,
) {
  if (![inbound, outbound].every((n) => Number.isSafeInteger(n) && n >= 0))
    throw Error("Invalid node counters");
  const source = `node-total:${nodeId}`;
  const prev = s.db
    .query<
      { epoch: string; inbound: number; outbound: number; at: number },
      [string]
    >("SELECT * FROM counters WHERE source=?")
    .get(source);
  const valid =
    prev &&
    prev.epoch === epoch &&
    inbound >= prev.inbound &&
    outbound >= prev.outbound;
  if (prev && !valid) {
    s.event(nodeId, "traffic.gap", {
      from: prev.at,
      to: at,
      reason: "Node counter epoch changed",
    });
    s.alert(
      nodeId,
      "accounting-gap",
      "Node counters changed epoch; unrecoverable traffic was not estimated.",
    );
  }
  s.db
    .query(
      "INSERT INTO counters VALUES(?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET epoch=excluded.epoch,inbound=excluded.inbound,outbound=excluded.outbound,at=excluded.at",
    )
    .run(source, epoch, inbound, outbound, at);
  return {
    inbound: valid ? inbound - prev.inbound : prev ? 0 : inbound,
    outbound: valid ? outbound - prev.outbound : prev ? 0 : outbound,
  };
}
