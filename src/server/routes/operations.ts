import { z } from "zod";
import { strip } from "../db";
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
          kickUser(s, e.id);
        } else {
          unassign(
            e.kind === "node"
              ? [e.id]
              : s
                  .list("node")
                  .filter((n) => n.hostId === e.id)
                  .map((n) => n.id),
          );
          s.put(
            e.kind,
            { ...strip(e), deleting: true, enabled: false },
            undefined,
            e.id,
          );
          enqueue(s, e.kind === "host" ? e.id : e.hostId, "delete", {
            entityId: e.id,
          });
        }
        s.event(e.id, "deletion.requested", {});
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
    entity(task.host, "host");
    return c.json({
      id: enqueue(s, task.host, task.kind, JSON.parse(task.payload)),
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

  app.get("/api/history/:id", (c) => {
    const id = c.req.param("id");
    if (!s.get(id)) throw Error("Record not found");
    const start = Number(c.req.query("start") || Date.now() - 86400000),
      end = Number(c.req.query("end") || Date.now());
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      throw Error("Invalid time range");
    const resolution =
      start < Date.now() - 365 * 86400000
        ? "day"
        : start < Date.now() - 30 * 86400000
          ? "hour"
          : "minute";
    const bucket =
      resolution === "day" ? 86400000 : resolution === "hour" ? 3600000 : 60000;
    const samples = s.db
      .query(
        `SELECT CAST(at/? AS INTEGER)*? AS at,SUM(inbound) AS inbound,SUM(outbound) AS outbound,SUM(cpu*metric_count)/NULLIF(SUM(metric_count),0) AS cpu,SUM(memory*metric_count)/NULLIF(SUM(metric_count),0) AS memory,SUM(disk*metric_count)/NULLIF(SUM(metric_count),0) AS disk,CAST(SUM(successes) AS REAL)/NULLIF(SUM(observations),0) AS reachable,MAX(cpu_max) AS cpu_max,MAX(memory_max) AS memory_max,MAX(disk_max) AS disk_max,SUM(observations) AS observations,SUM(successes) AS successes FROM samples WHERE entity=? AND at>=? AND at<=? GROUP BY CAST(at/? AS INTEGER) ORDER BY at`,
      )
      .all(bucket, bucket, id, start, end, bucket);
    return c.json({
      samples,
      resolution,
      events: s.db
        .query(
          "SELECT * FROM events WHERE entity=? AND at>=? AND at<=? ORDER BY at DESC LIMIT 500",
        )
        .all(id, start, end),
    });
  });
}
