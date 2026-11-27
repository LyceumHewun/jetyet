import { z } from "zod";
import { strip } from "../db";
import { nodeVerifiedRevision } from "../deployment";
import { revokePortalAccess } from "../sign-in";
import { enqueue, kickUser } from "../tasks";
import type { Routes } from "./context";

export function registerOperationsRoutes({
  app,
  s,
  entity,
  view,
  checked,
}: Routes) {
  function unassign(ids: string[]) {
    for (const user of s.list("user")) {
      const nodeIds = user.nodeIds.filter((id: string) => !ids.includes(id));
      if (nodeIds.length !== user.nodeIds.length) {
        s.put("user", { ...strip(user), nodeIds }, undefined, user.id);
        s.event(user.id, "nodes.unassigned", { nodeIds: ids });
      }
    }
  }
  app.get("/api/archive/:kind", (c) => {
    const kind = (
      { hosts: "host", nodes: "node", users: "user" } as Record<string, string>
    )[c.req.param("kind")];
    if (!kind) throw Error("Invalid archive");
    return c.json(s.list(kind, true).map(view));
  });
  app.delete("/api/:kind/:id", async (c) => {
    const kind = c.req.param("kind"),
      e = entity(
        c.req.param("id"),
        (
          { hosts: "host", nodes: "node", users: "user" } as Record<
            string,
            string
          >
        )[kind] || "invalid",
      );
    s.db
      .transaction(() => {
        if (e.kind === "user") {
          s.db.query("UPDATE entities SET deleted=1 WHERE id=?").run(e.id);
          revokePortalAccess(s, e.id);
          s.db.query("DELETE FROM portal_passwords WHERE user=?").run(e.id);
          kickUser(s, e.id);
          s.event(e.id, "deletion.requested", {});
        } else {
          const hostId = e.kind === "host" ? e.id : e.hostId;
          const childNodes =
            e.kind === "host"
              ? s.list("node").filter((n) => n.hostId === e.id)
              : [];
          unassign(e.kind === "node" ? [e.id] : childNodes.map((n) => n.id));
          for (const n of childNodes) {
            if (!n.deleting || n.enabled)
              s.put(
                "node",
                { ...strip(n), deleting: true, enabled: false },
                undefined,
                n.id,
              );
          }
          if (!e.deleting || e.enabled)
            s.put(
              e.kind,
              { ...strip(e), deleting: true, enabled: false },
              undefined,
              e.id,
            );
          const activeDelete = s.db
            .query<{ id: string }, [string, string]>(
              "SELECT id FROM tasks WHERE host=? AND kind='delete' AND state IN ('queued','running') AND json_extract(payload,'$.entityId')=? LIMIT 1",
            )
            .get(hostId, e.id);
          if (!activeDelete) {
            enqueue(s, hostId, "delete", { entityId: e.id });
            if (!e.deleting) s.event(e.id, "deletion.requested", {});
          }
        }
      })
      .immediate();
    return c.json({ ok: true }, 202);
  });

  app.post("/api/hosts/:id/force-remove", async (c) => {
    const h = entity(c.req.param("id"), "host");
    z.object({
      confirmation: z.literal("REMOTE HOST DESTROYED OR HANDLED INDEPENDENTLY"),
    }).parse(await c.req.json());
    s.db
      .transaction(() => {
        unassign(
          s
            .list("node")
            .filter((n) => n.hostId === h.id)
            .map((n) => n.id),
        );
        for (const e of [
          h,
          ...s.list("node").filter((n) => n.hostId === h.id),
        ]) {
          s.db.query("UPDATE entities SET deleted=1 WHERE id=?").run(e.id);
          s.event(e.id, "deletion.forced", { remoteCleanup: "unverified" });
        }
        s.db
          .query(
            "UPDATE tasks SET cancel=1,state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END WHERE host=? AND state IN ('queued','running')",
          )
          .run(h.id);
      })
      .immediate();
    return c.json({ ok: true });
  });

  app.post("/api/tasks/:id/cancel", (c) => {
    s.db
      .query(
        "UPDATE tasks SET cancel=1,state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END,updated=? WHERE id=? AND state IN ('queued','running')",
      )
      .run(Date.now(), c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/tasks/:id/retry", (c) => {
    const task = s.db
      .query<any, [string]>("SELECT * FROM tasks WHERE id=?")
      .get(c.req.param("id"));
    if (!task || !["failed", "cancelled"].includes(task.state))
      throw Error("Only failed or cancelled tasks can be retried");
    const host = entity(task.host, "host");
    const payload = JSON.parse(task.payload);
    if (
      ["deploy", "upgrade", "reapply"].includes(task.kind) &&
      typeof payload?.expectedRevision === "string" &&
      payload.expectedRevision &&
      typeof payload?.nodeId === "string"
    ) {
      const node = entity(payload.nodeId, "node");
      if (nodeVerifiedRevision(s, node, host) !== payload.expectedRevision)
        throw Error(
          "Node settings changed since this task was created; reopen the node operation form to queue a new task",
        );
    }
    return c.json({
      id: enqueue(s, task.host, task.kind, payload),
    });
  });

  app.get("/api/tasks/:id/logs", (c) =>
    c.json(
      s.db
        .query("SELECT * FROM task_logs WHERE task=? ORDER BY at")
        .all(c.req.param("id")),
    ),
  );

  app.post("/api/alerts/:id/:action", (c) => {
    const action = c.req.param("action");
    if (action === "read")
      s.db.query("UPDATE alerts SET seen=1 WHERE id=?").run(c.req.param("id"));
    else if (action === "close")
      s.db
        .query("UPDATE alerts SET closed=? WHERE id=? AND closed IS NULL")
        .run(Date.now(), c.req.param("id"));
    else throw Error("Unknown action");
    return c.json({ ok: true });
  });

  const BUCKET_LADDER = [
    60_000,
    300_000,
    900_000,
    3_600_000,
    7_200_000,
    21_600_000,
    86_400_000,
  ] as const;

  function pickBucket(start: number, end: number, rawMaxPoints?: string) {
    const now = Date.now(),
      cutoffHour = now - 30 * 86400000 - 600000,
      cutoffDay = now - 365 * 86400000 - 3600000;
    const minBucket =
      start < cutoffDay ? 86_400_000 : start < cutoffHour ? 3_600_000 : 60_000;
    const parsedMax = rawMaxPoints ? Number(rawMaxPoints) : 180;
    const maxPoints = Number.isFinite(parsedMax)
      ? Math.max(24, Math.min(360, Math.floor(parsedMax)))
      : 180;
    const span = end - start;
    const bucket =
      BUCKET_LADDER.find((b) => b >= minBucket && span / b <= maxPoints) ??
      86_400_000;
    const resolution =
      bucket >= 86_400_000 ? "day" : bucket >= 3_600_000 ? "hour" : "minute";
    return { bucket, resolution };
  }

  app.get("/api/history/:id", (c) => {
    const id = c.req.param("id");
    const isControlPlane = id === "control-plane";
    const target = isControlPlane ? null : s.get(id);
    if (!isControlPlane && !target) throw Error("Record not found");
    const start = Number(c.req.query("start") || Date.now() - 86400000),
      end = Number(c.req.query("end") || Date.now());
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      throw Error("Invalid time range");
    const { bucket, resolution } = pickBucket(
      start,
      end,
      c.req.query("maxPoints"),
    );
    const includeEvents = c.req.query("includeEvents") !== "0";
    const hasHostMetrics = isControlPlane || target?.kind === "host";
    const samples = hasHostMetrics
      ? s.db
          .query(
            `SELECT CAST(at/? AS INTEGER)*? AS at,SUM(inbound) FILTER (WHERE traffic_available = 1) AS inbound,SUM(outbound) FILTER (WHERE traffic_available = 1) AS outbound,ROUND(SUM(cpu*metric_count)/NULLIF(SUM(metric_count),0),1) AS cpu,ROUND(SUM(memory*metric_count)/NULLIF(SUM(metric_count),0),1) AS memory,ROUND(SUM(disk*metric_count)/NULLIF(SUM(metric_count),0),1) AS disk,ROUND(CAST(SUM(successes) AS REAL)/NULLIF(SUM(observations),0),4) AS reachable,ROUND(MAX(cpu_max),1) AS cpu_max,ROUND(MAX(memory_max),1) AS memory_max,ROUND(MAX(disk_max),1) AS disk_max,SUM(observations) AS observations,SUM(successes) AS successes FROM samples WHERE entity=? AND at>=? AND at<=? GROUP BY CAST(at/? AS INTEGER) ORDER BY at`,
          )
          .all(bucket, bucket, id, start, end, bucket)
      : s.db
          .query(
            `SELECT CAST(at/? AS INTEGER)*? AS at,SUM(inbound) AS inbound,SUM(outbound) AS outbound FROM samples WHERE entity=? AND at>=? AND at<=? GROUP BY CAST(at/? AS INTEGER) ORDER BY at`,
          )
          .all(bucket, bucket, id, start, end, bucket);
    return c.json({
      samples,
      resolution,
      bucketMs: bucket,
      events: includeEvents
        ? s.db
            .query(
              "SELECT * FROM events WHERE entity=? AND at>=? AND at<=? ORDER BY at DESC LIMIT 500",
            )
            .all(id, start, end)
        : [],
    });
  });

  app.get("/api/overview/traffic", (c) => {
    const scope = c.req.query("scope") === "users" ? "users" : "hosts";
    const start = Number(c.req.query("start") || Date.now() - 86400000),
      end = Number(c.req.query("end") || Date.now());
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      throw Error("Invalid time range");
    const { bucket, resolution } = pickBucket(
      start,
      end,
      c.req.query("maxPoints") || "96",
    );
    const kind = scope === "users" ? "user" : "host";
    const samples = s.db
      .query(
        `SELECT CAST(sm.at/? AS INTEGER)*? AS at,SUM(sm.inbound) AS inbound,SUM(sm.outbound) AS outbound FROM samples sm INNER JOIN entities e ON e.id = sm.entity WHERE e.kind=? AND sm.at>=? AND sm.at<=? GROUP BY CAST(sm.at/? AS INTEGER) ORDER BY at`,
      )
      .all(bucket, bucket, kind, start, end, bucket);
    return c.json({ samples, resolution, bucketMs: bucket });
  });
}
