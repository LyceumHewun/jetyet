import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Config } from "./config";
import { digest, vault } from "./crypto";

export function storage(config: Config) {
  mkdirSync(dirname(config.database), { recursive: true });
  const db = new Database(config.database, { create: true, strict: true });
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;
    CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, secret TEXT NOT NULL DEFAULT '{}', deleted INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS entities_kind ON entities(kind,deleted);
    CREATE UNIQUE INDEX IF NOT EXISTS one_node_per_host ON entities(json_extract(data,'$.hostId')) WHERE kind='node' AND deleted=0;
    CREATE TABLE IF NOT EXISTS usage (id TEXT PRIMARY KEY REFERENCES entities(id), inbound INTEGER NOT NULL DEFAULT 0, outbound INTEGER NOT NULL DEFAULT 0, start INTEGER NOT NULL, next INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS counters (source TEXT PRIMARY KEY, epoch TEXT NOT NULL, inbound INTEGER NOT NULL, outbound INTEGER NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS samples (id INTEGER PRIMARY KEY, entity TEXT NOT NULL, at INTEGER NOT NULL, inbound INTEGER NOT NULL, outbound INTEGER NOT NULL, resolution TEXT NOT NULL DEFAULT 'minute', cpu REAL, memory REAL, disk REAL, reachable REAL, cpu_max REAL, memory_max REAL, disk_max REAL, observations INTEGER NOT NULL DEFAULT 0, successes INTEGER NOT NULL DEFAULT 0, metric_count INTEGER NOT NULL DEFAULT 0, UNIQUE(entity,at,resolution));
    CREATE INDEX IF NOT EXISTS samples_lookup ON samples(entity,resolution,at);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, entity TEXT, type TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, entity TEXT NOT NULL, code TEXT NOT NULL, message TEXT NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL, closed INTEGER, seen INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS alerts_active ON alerts(entity,code,closed);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, host TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', step INTEGER NOT NULL DEFAULT 0, error TEXT, cancel INTEGER NOT NULL DEFAULT 0, lease INTEGER, owner TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS tasks_queue ON tasks(state,kind,created);
    CREATE TABLE IF NOT EXISTS task_logs (id INTEGER PRIMARY KEY, task TEXT NOT NULL, message TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS heartbeats (name TEXT PRIMARY KEY, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, version TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS first_auth (node TEXT NOT NULL, user TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(node,user));
    CREATE TABLE IF NOT EXISTS token_index (hash TEXT PRIMARY KEY, entity TEXT NOT NULL, kind TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS token_index_entity ON token_index(entity);
  `);
  const crypt = vault(config.masterKey);
  db.exec(
    "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  db.query("INSERT OR IGNORE INTO metadata VALUES(?,?)").run(
    "vault-check",
    crypt.seal("jetyet-vault"),
  );
  const check = db
    .query<{ value: string }, []>(
      "SELECT value FROM metadata WHERE key='vault-check'",
    )
    .get();
  if (!check || crypt.open(check.value) !== "jetyet-vault")
    throw Error("Invalid encryption master key");
  function syncTokenIndex(id: string, secret: Record<string, string>) {
    db.query("DELETE FROM token_index WHERE entity=?").run(id);
    if (secret.vpnToken)
      db.query("INSERT OR REPLACE INTO token_index VALUES(?,?,?)").run(
        digest(secret.vpnToken),
        id,
        "vpn",
      );
    if (secret.subscriptionToken)
      db.query("INSERT OR REPLACE INTO token_index VALUES(?,?,?)").run(
        digest(secret.subscriptionToken),
        id,
        "sub",
      );
  }
  for (const row of db
    .query<{ id: string; secret: string }, []>(
      "SELECT id, secret FROM entities WHERE kind='user' AND deleted=0 AND NOT EXISTS (SELECT 1 FROM token_index WHERE entity=entities.id)",
    )
    .all()) {
    syncTokenIndex(row.id, JSON.parse(crypt.open(row.secret)));
  }
  type Row = {
    id: string;
    kind: string;
    data: string;
    secret: string;
    deleted: number;
    created: number;
  };
  function decode(r: Row | null): Entity | null {
    return r
      ? {
          id: r.id,
          kind: r.kind,
          ...JSON.parse(r.data),
          deleted: !!r.deleted,
          created: r.created,
        }
      : null;
  }
  const get = (id: string) =>
    decode(
      db.query<Row, [string]>("SELECT * FROM entities WHERE id=?").get(id),
    );
  const list = (kind: string, deleted = false) =>
    db
      .query<Row, [string, number]>(
        "SELECT * FROM entities WHERE kind=? AND deleted=? ORDER BY created",
      )
      .all(kind, Number(deleted))
      .map((r) => decode(r)!);
  function put(
    kind: string,
    data: Record<string, any>,
    secret?: Record<string, string>,
    id: string = crypto.randomUUID(),
  ) {
    const existing = get(id);
    db.query(
      `INSERT INTO entities(id,kind,data,secret,created) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,secret=CASE WHEN ? THEN excluded.secret ELSE entities.secret END`,
    ).run(
      id,
      kind,
      JSON.stringify(data),
      crypt.seal(JSON.stringify(secret || {})),
      existing?.created || Date.now(),
      Number(secret !== undefined),
    );
    if (secret !== undefined && kind === "user") syncTokenIndex(id, secret);
    return get(id)!;
  }
  const secrets = (id: string): Record<string, string> => {
    const r = db
      .query<{ secret: string }, [string]>(
        "SELECT secret FROM entities WHERE id=?",
      )
      .get(id);
    if (!r) throw Error("Entity not found");
    return JSON.parse(crypt.open(r.secret));
  };
  function event(entity: string | null, type: string, data: unknown) {
    db.query("INSERT INTO events VALUES(?,?,?,?,?)").run(
      crypto.randomUUID(),
      entity,
      type,
      JSON.stringify(data),
      Date.now(),
    );
  }
  function alert(entity: string, code: string, message: string) {
    const r = db
      .query<{ id: string }, [string, string]>(
        "SELECT id FROM alerts WHERE entity=? AND code=? AND closed IS NULL",
      )
      .get(entity, code);
    if (r)
      db.query("UPDATE alerts SET last=?,message=? WHERE id=?").run(
        Date.now(),
        message,
        r.id,
      );
    else
      db.query(
        "INSERT INTO alerts(id,entity,code,message,first,last) VALUES(?,?,?,?,?,?)",
      ).run(crypto.randomUUID(), entity, code, message, Date.now(), Date.now());
  }
  function resolveAlert(entity: string, code: string) {
    db.query(
      "UPDATE alerts SET closed=? WHERE entity=? AND code=? AND closed IS NULL",
    ).run(Date.now(), entity, code);
  }
  return {
    db,
    config,
    get,
    list,
    put,
    secrets,
    event,
    alert,
    resolveAlert,
    crypt,
  };
}
export type Entity = {
  id: string;
  kind: string;
  deleted: boolean;
  created: number;
  [key: string]: any;
};
export type Store = ReturnType<typeof storage>;
export function strip(e: Entity) {
  const { id, kind, created, deleted, ...rest } = e;
  return rest;
}
