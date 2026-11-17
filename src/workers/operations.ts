import { loadWorkerConfig } from "../server/config";
import { digest } from "../server/crypto";
import { storage, strip, type Store } from "../server/db";
import {
  deploymentScript,
  detectionScript,
  removeScript,
  serverConfig,
} from "../server/deployment";
import { safeError } from "../server/errors";
import { execute, withHost } from "../server/ssh";
import { beat, claim, finish, type Task } from "../server/tasks";

export async function runOperation(
  s: Store,
  t: Task,
  runner?: (script: string) => Promise<string>,
) {
  const p = JSON.parse(t.payload),
    h = s.get(t.host);
  if (!h || h.deleted) throw Error("VPS removed");
  const n = p.nodeId
    ? s.get(p.nodeId)
    : s.list("node").find((n) => n.hostId === h.id);
  function checkpoint(step: number, message: string) {
    const row = s.db
      .query<{ cancel: number; owner: string }, [string]>(
        "SELECT cancel,owner FROM tasks WHERE id=?",
      )
      .get(t.id);
    if (row?.cancel) throw Error("Cancelled at safe step boundary");
    if (row?.owner !== t.owner) throw Error("Operation lease lost");
    s.db
      .query("UPDATE tasks SET step=?,updated=? WHERE id=?")
      .run(step, Date.now(), t.id);
    s.db
      .query("INSERT INTO task_logs(task,message,at) VALUES(?,?,?)")
      .run(t.id, message, Date.now());
  }
  checkpoint(0, "Inspecting remote host");
  const execRemote = async (run: (script: string) => Promise<string>) => {
    if (["deploy", "upgrade", "reapply"].includes(t.kind)) {
      if (!n || n.deleted || n.deleting) throw Error("Node removed");
      checkpoint(
        1,
        "Applying native Hysteria 2 deployment; existing connections may be interrupted",
      );
      await run(deploymentScript(s, n, p.version, t.kind === "reapply"));
      checkpoint(2, "Verifying deployment");
      const actual = JSON.parse(await run(detectionScript));
      const curHost = s.get(h.id);
      const curNode = s.get(n.id);
      if (!curHost || curHost.deleted || !curNode || curNode.deleted)
        throw Error("Entity removed during deployment");
      if (
        actual.nodeId !== curNode.id ||
        actual.phase !== "ready" ||
        !actual.actualVersion.includes(actual.version) ||
        actual.actualHash !== digest(serverConfig(s, curNode)) ||
        !actual.active
      )
        throw Error("Deployed configuration verification failed");
      s.put(
        "node",
        {
          ...strip(curNode),
          status: "ready",
          version: actual.version,
          configHash: actual.configHash,
        },
        undefined,
        curNode.id,
      );
      if (
        !curNode.enabled ||
        !curHost.enabled ||
        curNode.deleting ||
        curHost.deleting
      )
        await run("set -e\nsystemctl stop jetyet-hysteria.service\n");
    } else if (t.kind === "detect") {
      if (!n || n.deleted || n.deleting)
        throw Error("Plan a node before detection");
      checkpoint(1, "Detecting platform-owned deployment");
      let actual = JSON.parse(await run(detectionScript));
      const curHost = s.get(h.id);
      const curNode = s.get(n.id);
      if (
        !curHost ||
        curHost.deleted ||
        curHost.deleting ||
        !curNode ||
        curNode.deleted ||
        curNode.deleting ||
        curNode.hostId !== curHost.id
      )
        throw Error("Entity removed during detection");
      const expectedHash = digest(serverConfig(s, curNode));
      if (
        actual.owner !== "jetyet" ||
        actual.phase !== "ready" ||
        typeof actual.version !== "string" ||
        !actual.version ||
        typeof actual.actualVersion !== "string" ||
        !actual.actualVersion.includes(actual.version) ||
        actual.nodeId !== curNode.id ||
        actual.hostId !== curHost.id ||
        actual.actualHash !== expectedHash
      )
        throw Error("Remote deployment does not match the planned node");
      const wantActive = !!(curHost.enabled && curNode.enabled);
      if (actual.active !== wantActive) {
        await run(
          `set -e\nexec 9>/run/jetyet-operation.lock\nflock -w 15 9\nsystemctl ${wantActive ? "start" : "stop"} jetyet-hysteria.service\n`,
        );
        actual = JSON.parse(await run(detectionScript));
        if (
          actual.owner !== "jetyet" ||
          actual.phase !== "ready" ||
          typeof actual.version !== "string" ||
          !actual.version ||
          typeof actual.actualVersion !== "string" ||
          !actual.actualVersion.includes(actual.version) ||
          actual.nodeId !== curNode.id ||
          actual.hostId !== curHost.id ||
          actual.actualHash !== expectedHash ||
          actual.active !== wantActive
        )
          throw Error(
            wantActive
              ? "Remote deployment failed to start with verified rules"
              : "Remote deployment failed to stop",
          );
      }
      const shouldStop = s.db
        .transaction(() => {
          const latestHost = s.get(h.id);
          const latestNode = s.get(n.id);
          if (
            !latestHost ||
            latestHost.deleted ||
            latestHost.deleting ||
            !latestNode ||
            latestNode.deleted ||
            latestNode.deleting ||
            latestNode.hostId !== latestHost.id
          )
            throw Error("Entity removed during detection");
          if (
            actual.nodeId !== latestNode.id ||
            actual.hostId !== latestHost.id ||
            actual.actualHash !== digest(serverConfig(s, latestNode)) ||
            (latestNode.hopping ?? "") !== (curNode.hopping ?? "") ||
            latestNode.address !== curNode.address
          )
            throw Error("Planned node configuration changed during detection");
          s.put(
            "node",
            {
              ...strip(latestNode),
              status: "ready",
              version: actual.version,
              configHash: actual.configHash,
            },
            undefined,
            latestNode.id,
          );
          return !(latestHost.enabled && latestNode.enabled);
        })
        .immediate();
      if (shouldStop && actual.active) {
        await run(
          "set -e\nexec 9>/run/jetyet-operation.lock\nflock -w 15 9\nsystemctl stop jetyet-hysteria.service\n",
        );
      }
    } else if (t.kind === "host-state" || t.kind === "node-state") {
      const curHost = s.get(h.id);
      const curNode = p.nodeId
        ? s.get(p.nodeId)
        : s.list("node").find((node) => node.hostId === h.id) || null;
      if (
        curHost &&
        !curHost.deleted &&
        !curHost.deleting &&
        curNode &&
        !curNode.deleted &&
        !curNode.deleting &&
        curNode.status !== "draft"
      ) {
        checkpoint(1, "Applying administrator service state");
        await run(
          `set -e\nexec 9>/run/jetyet-operation.lock\nflock -w 15 9\nsystemctl ${curHost.enabled && curNode.enabled ? "start" : "stop"} jetyet-hysteria.service\n`,
        );
      }
    } else if (t.kind === "delete") {
      const target = s.get(p.entityId);
      if (!target) throw Error("Deletion target missing");
      checkpoint(1, "Removing platform-owned VPN service and credentials");
      if (n) await run(removeScript(n.id));
      checkpoint(2, "Remote cleanup confirmed");
      s.db
        .transaction(() => {
          if (n)
            s.db.query("UPDATE entities SET deleted=1 WHERE id=?").run(n.id);
          s.db.query("UPDATE entities SET deleted=1 WHERE id=?").run(target.id);
          s.event(target.id, "deletion.completed", {
            remoteCleanup: "confirmed",
          });
        })
        .immediate();
    } else throw Error("Unknown remote operation");
    checkpoint(3, "Completed");
  };
  if (runner) await execRemote(runner);
  else
    await withHost(s, h, (c) =>
      execRemote((script) => execute(c, script, h.username !== "root", 300000)),
    );
}
if (import.meta.main) {
  const s = storage(await loadWorkerConfig()),
    owner = crypto.randomUUID();
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  let active: Task | null = null;
  const heartbeat = setInterval(() => {
    beat(s, "operations");
    if (active)
      s.db
        .query("UPDATE tasks SET lease=? WHERE id=? AND owner=?")
        .run(Date.now() + 90000, active.id, owner);
  }, 10000);
  beat(s, "operations");
  while (!stopping) {
    const t = claim(s, false, owner);
    if (!t) {
      await Bun.sleep(1000);
      continue;
    }
    active = t;
    try {
      await runOperation(s, t);
      finish(s, t, "succeeded");
      s.resolveAlert(t.host, "operation-failed");
    } catch (error) {
      const cancelled = !!s.db
        .query<{ cancel: number }, [string]>(
          "SELECT cancel FROM tasks WHERE id=?",
        )
        .get(t.id)?.cancel;
      const message = cancelled
        ? "Cancelled at a safe boundary; completed changes are retained."
        : safeError(s, error);
      finish(s, t, cancelled ? "cancelled" : "failed", message);
      if (!cancelled) s.alert(t.host, "operation-failed", message);
    } finally {
      active = null;
    }
  }
  clearInterval(heartbeat);
  s.db.close();
}
