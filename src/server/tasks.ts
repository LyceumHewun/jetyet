import type { Store } from "./db";
export type Task = {
  id: string;
  host: string;
  kind: string;
  payload: string;
  state: string;
  step: number;
  cancel: number;
  owner: string;
  created: number;
};
export function enqueue(
  s: Store,
  host: string,
  kind: string,
  payload: unknown = {},
) {
  const id = crypto.randomUUID(),
    now = Date.now();
  s.db
    .query(
      "INSERT INTO tasks(id,host,kind,payload,created,updated) VALUES(?,?,?,?,?,?)",
    )
    .run(id, host, kind, JSON.stringify(payload), now, now);
  s.event(host, "operation.queued", { task: id, kind });
  return id;
}
export function kickUser(s: Store, userId: string, onlyNodes?: string[]) {
  for (const n of s
    .list("node")
    .filter(
      (n) =>
        n.status === "ready" &&
        !n.deleting &&
        (!onlyNodes || onlyNodes.includes(n.id)),
    )) {
    const pending = s.db
      .query(
        "SELECT id FROM tasks WHERE host=? AND kind=? AND payload=? AND state IN ('queued','running')",
      )
      .get(
        n.hostId,
        "kick",
        JSON.stringify({ nodeId: n.id, userIds: [userId] }),
      );
    if (!pending)
      enqueue(s, n.hostId, "kick", { nodeId: n.id, userIds: [userId] });
  }
}
export function claim(s: Store, monitor: boolean, owner: string): Task | null {
  return s.db
    .transaction(() => {
      const now = Date.now();
      s.db
        .query(
          "UPDATE tasks SET state='queued',owner=NULL WHERE state='running' AND lease<?",
        )
        .run(now);
      const filter = monitor
        ? "t.kind='kick' AND NOT EXISTS (SELECT 1 FROM tasks busy WHERE busy.host=t.host AND busy.state='running' AND busy.kind='kick')"
        : "t.kind!='kick' AND NOT EXISTS (SELECT 1 FROM tasks busy WHERE busy.host=t.host AND busy.state='running' AND busy.kind!='kick')";
      const t = s.db
        .query<Task, [number]>(
          `SELECT t.* FROM tasks t WHERE t.state='queued' AND (t.lease IS NULL OR t.lease<=?) AND ${filter} AND t.cancel=0 ORDER BY t.updated,t.created LIMIT 1`,
        )
        .get(now);
      if (!t) return null;
      s.db
        .query(
          "UPDATE tasks SET state='running',owner=?,lease=?,updated=? WHERE id=?",
        )
        .run(owner, now + 90000, now, t.id);
      return { ...t, owner };
    })
    .immediate();
}
export function finish(
  s: Store,
  task: Task,
  state: string,
  error: string | null = null,
) {
  s.db
    .query(
      "UPDATE tasks SET state=?,error=?,lease=NULL,updated=? WHERE id=? AND owner=?",
    )
    .run(state, error, Date.now(), task.id, task.owner);
  s.event(task.host, "operation." + state, { task: task.id, kind: task.kind });
}
export function beat(s: Store, name: string) {
  s.db
    .query(
      "INSERT INTO heartbeats VALUES(?,?) ON CONFLICT(name) DO UPDATE SET at=excluded.at",
    )
    .run(name, Date.now());
}
