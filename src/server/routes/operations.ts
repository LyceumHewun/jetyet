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

  app.post("/api/alerts/read-all", async (c) => {
    let openOnly = true;
    try {
      const body = await c.req.json();
      if (typeof body?.openOnly === "boolean") openOnly = body.openOnly;
    } catch {}
    const res = openOnly
      ? s.db
          .query("UPDATE alerts SET seen=1 WHERE seen=0 AND closed IS NULL")
          .run()
      : s.db.query("UPDATE alerts SET seen=1 WHERE seen=0").run();
    return c.json({ ok: true, updated: res.changes });
  });

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

  function entityMeta(id: string | null | undefined) {
    if (!id) {
      return {
        entityName: null,
        entityKind: null,
        entityDeleted: false,
        entityHostId: null,
      };
    }
    if (id === "platform") {
      return {
        entityName: null,
        entityKind: "platform",
        entityDeleted: false,
        entityHostId: null,
      };
    }
    if (id === "control-plane") {
      return {
        entityName: null,
        entityKind: "control-plane",
        entityDeleted: false,
        entityHostId: null,
      };
    }
    const e = s.get(id);
    if (!e) {
      return {
        entityName: null,
        entityKind: null,
        entityDeleted: true,
        entityHostId: null,
      };
    }
    return {
      entityName: e.name ?? e.username ?? id,
      entityKind: e.kind,
      entityDeleted: e.deleted,
      entityHostId: e.kind === "node" ? (e.hostId ?? null) : null,
    };
  }

  function parsePage(
    rawPage?: string,
    rawSize?: string,
    rawOffset?: string,
  ) {
    const p = Number(rawPage || 1);
    const sz = Number(rawSize || 30);
    const page = Number.isFinite(p) ? Math.max(1, Math.floor(p)) : 1;
    const pageSize = Number.isFinite(sz)
      ? Math.max(10, Math.min(200, Math.floor(sz)))
      : 30;
    const rawOff = rawOffset !== undefined ? Number(rawOffset) : NaN;
    const offset =
      Number.isFinite(rawOff) && rawOff >= 0
        ? Math.floor(rawOff)
        : (page - 1) * pageSize;
    return { page, pageSize, offset };
  }

  app.get("/api/activity/alerts", (c) => {
    const status = c.req.query("status") || "open";
    const code = (c.req.query("code") || "").trim();
    const q = (c.req.query("q") || "").trim().toLowerCase();
    const { page, pageSize, offset } = parsePage(
      c.req.query("page"),
      c.req.query("pageSize"),
      c.req.query("offset"),
    );

    const where: string[] = [];
    const params: any[] = [];
    if (status === "open") where.push("a.closed IS NULL");
    else if (status === "unread") where.push("a.closed IS NULL AND a.seen = 0");
    else if (status === "closed") where.push("a.closed IS NOT NULL");
    if (code) {
      where.push("a.code = ?");
      params.push(code);
    }
    if (q) {
      const like = `%${q}%`;
      where.push(
        "(LOWER(a.code) LIKE ? OR LOWER(a.message) LIKE ? OR LOWER(a.entity) LIKE ? OR LOWER(COALESCE(json_extract(e.data,'$.name'),'')) LIKE ? OR LOWER(COALESCE(json_extract(e.data,'$.username'),'')) LIKE ? OR LOWER(COALESCE(json_extract(e.data,'$.address'),'')) LIKE ?)",
      );
      params.push(like, like, like, like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total =
      s.db
        .query<{ c: number }, any[]>(
          `SELECT COUNT(*) AS c FROM alerts a LEFT JOIN entities e ON e.id = a.entity ${whereSql}`,
        )
        .get(...params)?.c ?? 0;
    const rows = s.db
      .query<any, any[]>(
        `SELECT a.* FROM alerts a LEFT JOIN entities e ON e.id = a.entity ${whereSql} ORDER BY CASE WHEN a.closed IS NULL THEN 0 ELSE 1 END, a.last DESC, a.first DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset);

    const countRow = s.db
      .query<
        { open: number; unread: number; closed: number; total_count: number },
        []
      >(
        "SELECT SUM(CASE WHEN closed IS NULL THEN 1 ELSE 0 END) AS open, SUM(CASE WHEN closed IS NULL AND seen=0 THEN 1 ELSE 0 END) AS unread, SUM(CASE WHEN closed IS NOT NULL THEN 1 ELSE 0 END) AS closed, COUNT(*) AS total_count FROM alerts",
      )
      .get();
    const codes = s.db
      .query<{ code: string }, []>(
        "SELECT DISTINCT code FROM alerts ORDER BY code",
      )
      .all()
      .map((r) => r.code);

    return c.json({
      items: rows.map((a) => ({ ...a, ...entityMeta(a.entity) })),
      total,
      page,
      pageSize,
      offset,
      nextOffset: offset + rows.length,
      hasMore: offset + rows.length < total,
      counts: {
        open: countRow?.open ?? 0,
        unread: countRow?.unread ?? 0,
        closed: countRow?.closed ?? 0,
        all: countRow?.total_count ?? 0,
      },
      codes,
    });
  });

  app.get("/api/activity/tasks", (c) => {
    const state = c.req.query("state") || "all";
    const hideKick = c.req.query("hideKick") !== "0";
    const q = (c.req.query("q") || "").trim().toLowerCase();
    const { page, pageSize, offset } = parsePage(
      c.req.query("page"),
      c.req.query("pageSize"),
      c.req.query("offset"),
    );

    const baseWhere: string[] = [];
    const baseParams: any[] = [];
    if (hideKick) baseWhere.push("t.kind != 'kick'");
    if (q) {
      const like = `%${q}%`;
      baseWhere.push(
        "(LOWER(t.kind) LIKE ? OR LOWER(COALESCE(t.error,'')) LIKE ? OR LOWER(COALESCE(json_extract(h.data,'$.name'),'')) LIKE ? OR LOWER(COALESCE(json_extract(h.data,'$.address'),'')) LIKE ?)",
      );
      baseParams.push(like, like, like, like);
    }

    const where = [...baseWhere];
    const params = [...baseParams];
    if (state === "active") where.push("t.state IN ('queued','running')");
    else if (state === "failed") where.push("t.state = 'failed'");
    else if (state === "succeeded") where.push("t.state = 'succeeded'");
    else if (state === "cancelled") where.push("t.state = 'cancelled'");

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total =
      s.db
        .query<{ c: number }, any[]>(
          `SELECT COUNT(*) AS c FROM tasks t LEFT JOIN entities h ON h.id = t.host ${whereSql}`,
        )
        .get(...params)?.c ?? 0;
    const rows = s.db
      .query<any, any[]>(
        `SELECT t.* FROM tasks t LEFT JOIN entities h ON h.id = t.host ${whereSql} ORDER BY CASE WHEN t.state IN ('running','queued') THEN 0 ELSE 1 END, t.updated DESC, t.created DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset);

    const nonKickCounts = s.db
      .query<
        {
          total_count: number;
          active: number;
          failed: number;
          succeeded: number;
          hiddenKicks: number;
        },
        []
      >(
        `SELECT
          SUM(CASE WHEN ${hideKick ? "kind != 'kick'" : "1=1"} THEN 1 ELSE 0 END) AS total_count,
          SUM(CASE WHEN (${hideKick ? "kind != 'kick'" : "1=1"}) AND state IN ('queued','running') THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN (${hideKick ? "kind != 'kick'" : "1=1"}) AND state = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN (${hideKick ? "kind != 'kick'" : "1=1"}) AND state = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
          SUM(CASE WHEN kind = 'kick' THEN 1 ELSE 0 END) AS hiddenKicks
        FROM tasks`,
      )
      .get();

    return c.json({
      items: rows.map((t) => {
        const meta = entityMeta(t.host);
        return {
          ...t,
          hostName: meta.entityName,
          hostDeleted: meta.entityDeleted,
        };
      }),
      total,
      page,
      pageSize,
      offset,
      nextOffset: offset + rows.length,
      hasMore: offset + rows.length < total,
      counts: {
        all: nonKickCounts?.total_count ?? 0,
        active: nonKickCounts?.active ?? 0,
        failed: nonKickCounts?.failed ?? 0,
        succeeded: nonKickCounts?.succeeded ?? 0,
        hiddenKicks: nonKickCounts?.hiddenKicks ?? 0,
      },
    });
  });

  app.get("/api/activity/events", (c) => {
    const category = c.req.query("category") || "all";
    const q = (c.req.query("q") || "").trim().toLowerCase();
    const { page, pageSize, offset } = parsePage(
      c.req.query("page"),
      c.req.query("pageSize"),
      c.req.query("offset"),
    );

    const where: string[] = [];
    const params: any[] = [];
    if (category === "credentials") {
      where.push(
        "ev.type IN ('credentials.rotated','portal.password.changed','portal.password-link.issued','ssh.trusted')",
      );
    } else if (category === "traffic") {
      where.push("ev.type LIKE 'traffic.%'");
    } else if (category === "config") {
      where.push(
        "ev.type NOT LIKE 'traffic.%' AND ev.type NOT IN ('credentials.rotated','portal.password.changed','portal.password-link.issued','ssh.trusted')",
      );
    }
    let total: number;
    let rows: Record<string, any>[];
    if (q) {
      const like = `%${q}%`;
      where.push(
        `(LOWER(ev.type) LIKE ? OR LOWER(ev.data) LIKE ? OR ev.entity IN (
          SELECT id FROM entities
          WHERE LOWER(COALESCE(json_extract(data,'$.name'),'')) LIKE ?
            OR LOWER(COALESCE(json_extract(data,'$.username'),'')) LIKE ?
            OR LOWER(COALESCE(json_extract(data,'$.address'),'')) LIKE ?
        ))`,
      );
      params.push(like, like, like, like, like);
      const results = s.db
        .query<Record<string, any>, (string | number)[]>(
          `WITH matches AS MATERIALIZED (
          SELECT ev.rowid AS eventRow, ev.at FROM events ev WHERE ${where.join(" AND ")}
        ), page AS (
          SELECT eventRow, at FROM matches ORDER BY at DESC, eventRow LIMIT ? OFFSET ?
        )
        SELECT ev.*, counts.total AS matchTotal
        FROM (SELECT COUNT(*) AS total FROM matches) counts
        LEFT JOIN page ON true
        LEFT JOIN events ev ON ev.rowid=page.eventRow
        ORDER BY page.at DESC, page.eventRow`,
        )
        .all(...params, pageSize, offset);
      total = results[0]?.matchTotal ?? 0;
      rows = results
        .filter((row) => row.id !== null)
        .map(({ matchTotal, ...event }) => event);
    } else {
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      total =
        s.db.query<{ c: number }, []>(
          `SELECT COUNT(*) AS c FROM events ev ${whereSql}`,
        ).get()?.c ?? 0;
      rows = s.db
        .query<Record<string, any>, [number, number]>(
          `SELECT ev.* FROM events ev ${whereSql} ORDER BY ev.at DESC, ev.rowid LIMIT ? OFFSET ?`,
        )
        .all(pageSize, offset);
    }

    return c.json({
      items: rows.map((ev) => ({ ...ev, ...entityMeta(ev.entity) })),
      total,
      page,
      pageSize,
      offset,
      nextOffset: offset + rows.length,
      hasMore: offset + rows.length < total,
    });
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
