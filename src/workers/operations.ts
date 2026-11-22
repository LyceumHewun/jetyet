import {
  deploymentOptionsSchema,
  deploymentRequestSchema,
  deploymentVersionSchema,
  type DeploymentOptions,
} from "../shared/schemas";
import { loadWorkerConfig } from "../server/config";
import { digest } from "../server/crypto";
import { storage, strip, type Entity, type Store } from "../server/db";
import {
  deploymentScript,
  detectionScript,
  nodeDeploymentOptions,
  removeScript,
  serverConfig,
} from "../server/deployment";
import { safeError } from "../server/errors";
import { execute, withHost } from "../server/ssh";
import { beat, claim, finish, type Task } from "../server/tasks";

function matchesDeployment(
  s: Store,
  node: Entity,
  actual: Record<string, unknown>,
  options: DeploymentOptions,
  version: string,
) {
  const expectedHash = digest(serverConfig(s, node, options));
  return (
    actual.owner === "jetyet" &&
    actual.phase === "ready" &&
    actual.nodeId === node.id &&
    actual.hostId === node.hostId &&
    actual.address === node.address &&
    actual.hopping === node.hopping &&
    actual.port === node.port &&
    actual.protocol === options.protocol &&
    actual.congestion === options.congestion &&
    actual.tuning === options.tuning &&
    actual.version === version &&
    typeof actual.actualVersion === "string" &&
    actual.actualVersion.split(/[^\w.-]+/).includes(version) &&
    actual.configHash === expectedHash &&
    actual.actualHash === expectedHash
  );
}

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
      const version = deploymentVersionSchema.parse(p.version);
      const options =
        t.kind === "deploy"
          ? deploymentOptionsSchema.parse(p)
          : nodeDeploymentOptions(n);
      checkpoint(
        1,
        "Applying native Hysteria 2 deployment; existing connections may be interrupted",
      );
      const output = await run(
        deploymentScript(s, n, version, t.kind === "reapply", options),
      );
      for (const line of output.split("\n")) {
        if (line.startsWith("Adaptive tuning: "))
          checkpoint(1, safeError(s, Error(line)));
      }
      checkpoint(2, "Verifying deployment");
      let actual = JSON.parse(await run(detectionScript));
      const curHost = s.get(h.id);
      const curNode = s.get(n.id);
      if (!curHost || curHost.deleted || !curNode || curNode.deleted)
        throw Error("Entity removed during deployment");
      if (
        !matchesDeployment(s, curNode, actual, options, version) ||
        actual.active !== true
      )
        throw Error("Deployed configuration verification failed");
      if (
        !curNode.enabled ||
        !curHost.enabled ||
        curNode.deleting ||
        curHost.deleting
      ) {
        await run("set -e\nsystemctl stop jetyet-hysteria.service\n");
        actual = JSON.parse(await run(detectionScript));
      }
      s.db
        .transaction(() => {
          const latestHost = s.get(h.id);
          const latestNode = s.get(n.id);
          if (
            !latestHost ||
            latestHost.deleted ||
            latestHost.deleting ||
            !latestNode ||
            latestNode.deleted ||
            latestNode.deleting
          )
            throw Error("Entity removed during deployment");
          if (
            !matchesDeployment(s, latestNode, actual, options, version) ||
            actual.active !== Boolean(latestNode.enabled && latestHost.enabled)
          )
            throw Error("Deployed configuration verification failed");
          s.put(
            "node",
            {
              ...strip(latestNode),
              ...options,
              status: "ready",
              version,
              configHash: actual.configHash,
            },
            undefined,
            latestNode.id,
          );
        })
        .immediate();
    } else if (t.kind === "detect") {
      if (!n || n.deleted || n.deleting)
        throw Error("Plan a node before detection");
      checkpoint(1, "Detecting platform-owned deployment");
      let actual = JSON.parse(await run(detectionScript));
      const detected = deploymentRequestSchema.safeParse(actual);
      const current = () => {
        const host = s.get(t.host);
        const node = s.get(n.id);
        if (
          !host ||
          host.deleted ||
          host.deleting ||
          !node ||
          node.deleted ||
          node.deleting ||
          node.hostId !== host.id
        )
          throw Error("Entity removed during detection");
        return { node, active: Boolean(host.enabled && node.enabled) };
      };
      const planned = current();
      if (
        !detected.success ||
        !matchesDeployment(
          s,
          planned.node,
          actual,
          detected.data,
          detected.data.version,
        )
      )
        throw Error("Remote deployment does not match the planned node");
      const { version, ...options } = detected.data;
      const verifyState = async (wantActive: boolean) => {
        if (actual.active === wantActive) return;
        await run(
          `set -e\nexec 9>/run/jetyet-operation.lock\nflock -w 15 9\nsystemctl ${wantActive ? "start" : "stop"} jetyet-hysteria.service\n`,
        );
        actual = JSON.parse(await run(detectionScript));
        if (
          !matchesDeployment(s, planned.node, actual, options, version) ||
          actual.active !== wantActive
        )
          throw Error(
            wantActive
              ? "Remote deployment failed to start with verified rules"
              : "Remote deployment failed to stop",
          );
      };
      await verifyState(planned.active);
      const beforePublish = current();
      if (!matchesDeployment(s, beforePublish.node, actual, options, version))
        throw Error("Planned node configuration changed during detection");
      await verifyState(beforePublish.active);
      s.db
        .transaction(() => {
          const latest = current();
          if (
            !matchesDeployment(s, latest.node, actual, options, version) ||
            actual.active !== latest.active
          )
            throw Error("Planned node configuration changed during detection");
          s.put(
            "node",
            {
              ...strip(latest.node),
              ...options,
              status: "ready",
              version,
              configHash: actual.configHash,
            },
            undefined,
            latest.node.id,
          );
        })
        .immediate();
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
