import { z } from "zod";
import {
  deploymentRequestSchema,
  deploymentVersionSchema,
  nodeSchema,
} from "../../shared/schemas";
import { digest, token } from "../crypto";
import { strip, type Entity } from "../db";
import {
  deploymentScript,
  nodeDeploymentOptions,
  nodeVerifiedRevision,
  redactedConfig,
  serverConfig,
  validateDeploymentVersion,
} from "../deployment";
import { quote } from "../ssh";
import { enqueue } from "../tasks";
import { templateGroupNames } from "../templates";
import type { Routes } from "./context";

export function registerNodesRoutes({ app, s, entity }: Routes) {
  const revision = (n: Entity, host: Entity) => nodeVerifiedRevision(s, n, host);

  app.get("/deploy/:file", (c) => {
    c.header("Cache-Control", "no-store");
    const file = c.req.param("file");
    if (!/^[\w-]{43}\.sh$/.test(file)) return c.notFound();
    const link = s.db
      .query<
        { node: string; request: string; revision: string },
        [string, number]
      >(
        "SELECT node, request, revision FROM deployment_links WHERE hash=? AND expires>?",
      )
      .get(digest(file.slice(0, -3)), Date.now());
    if (!link) return c.notFound();
    const n = s.get(link.node);
    const h = n && s.get(n.hostId);
    if (
      !n ||
      n.deleted ||
      n.deleting ||
      !h ||
      h.deleted ||
      h.deleting ||
      !h.fingerprint ||
      revision(n, h) !== link.revision
    )
      return c.notFound();

    const { version, ...options } = deploymentRequestSchema.parse(
      JSON.parse(link.request),
    );
    c.header("X-Content-Type-Options", "nosniff");
    return c.text(deploymentScript(s, n, version, false, options));
  });

  app.post("/api/nodes", async (c) => {
    const data = nodeSchema.parse(await c.req.json());
    const h = entity(data.hostId, "host");
    if (h.deleting)
      throw Error("A host pending deletion cannot have new nodes");
    if (!h.fingerprint) throw Error("Confirm the SSH fingerprint first");
    if (s.list("node").some((n) => n.hostId === h.id))
      throw Error("Only one Hysteria 2 node is allowed per VPS");
    if (s.list("node").some((n) => n.name === data.name))
      throw Error("Node display names must be unique");
    if (templateGroupNames(s).has(data.name))
      throw Error(
        "Node display name conflicts with a subscription template group name",
      );
    const e = s.put(
      "node",
      { ...data, status: "draft" },
      { authSecret: token(), statsSecret: token(), probeToken: token() },
    );
    s.event(e.id, "node.planned", {});
    return c.json(e, 201);
  });

  app.put("/api/nodes/:id", async (c) => {
    const e = entity(c.req.param("id"), "node"),
      data = nodeSchema.parse(await c.req.json());
    if (e.deleting) throw Error("A node pending deletion cannot be modified");
    if (data.hostId !== e.hostId)
      throw Error("A node cannot move to another VPS");
    if (s.list("node").some((n) => n.id !== e.id && n.name === data.name))
      throw Error("Node display names must be unique");
    if (templateGroupNames(s).has(data.name))
      throw Error(
        "Node display name conflicts with a subscription template group name",
      );
    s.put("node", { ...strip(e), ...data }, undefined, e.id);
    if (e.enabled !== data.enabled)
      enqueue(s, e.hostId, "node-state", { nodeId: e.id });
    return c.json(entity(e.id));
  });

  app.post("/api/nodes/:id/operation", async (c) => {
    const n = entity(c.req.param("id"), "node");
    const h = entity(n.hostId, "host");
    if (n.deleting)
      throw Error("A node pending deletion cannot run operations");
    const raw = await c.req.json();
    const { kind } = z
      .object({
        kind: z.enum(["deploy", "upgrade", "reapply", "detect"]),
      })
      .parse(raw);
    const expectedRevision = revision(n, h);
    let payload: Record<string, unknown> = { nodeId: n.id };
    if (kind === "deploy") {
      const request = deploymentRequestSchema.parse(raw);
      validateDeploymentVersion(request.version, request);
      payload = { nodeId: n.id, expectedRevision, ...request };
    } else if (kind === "upgrade") {
      const current = nodeDeploymentOptions(n);
      const request = deploymentRequestSchema.parse({
        ...current,
        ...(raw && typeof raw === "object" ? raw : {}),
      });
      validateDeploymentVersion(request.version, request);
      payload = { nodeId: n.id, expectedRevision, ...request };
    } else if (kind === "reapply") {
      const { version } = z
        .object({ version: deploymentVersionSchema })
        .parse(raw);
      validateDeploymentVersion(version, nodeDeploymentOptions(n));
      payload = { nodeId: n.id, expectedRevision, version };
    }
    const id = enqueue(s, n.hostId, kind, payload);
    return c.json({ id }, 202);
  });

  app.post("/api/nodes/:id/command", async (c) => {
    const n = entity(c.req.param("id"), "node");
    const h = entity(n.hostId, "host");
    if (n.deleting || h.deleting || !h.fingerprint)
      throw Error("A verified VPS is required for manual installation");
    const request = deploymentRequestSchema.parse(await c.req.json());
    validateDeploymentVersion(request.version, request);
    const origin = new URL(s.config.origin);
    if (origin.protocol !== "https:")
      throw Error("Manual installation requires an HTTPS platform origin");
    const key = token();
    const now = Date.now();
    const expires = now + 15 * 60 * 1000;
    s.db
      .transaction(() => {
        s.db.query("DELETE FROM deployment_links WHERE expires<=?").run(now);
        s.db
          .query("INSERT INTO deployment_links VALUES(?,?,?,?,?)")
          .run(
            digest(key),
            n.id,
            JSON.stringify(request),
            revision(n, h),
            expires,
          );
      })
      .immediate();
    const url = new URL(`/deploy/${key}.sh`, origin);
    const install = `file=$(mktemp) || exit
trap 'rm -f -- "$file"' EXIT
curl -fsS "$1" -o "$file" && bash "$file"`.replaceAll("\n", "; ");
    c.header("Cache-Control", "no-store");
    return c.json({
      command: `bash -c ${quote(install)} -- ${quote(url.href)}`,
      expiresAt: new Date(expires).toISOString(),
    });
  });

  app.get("/api/nodes/:id/drift", (c) => {
    const n = entity(c.req.param("id"), "node");
    return c.json({
      desired: redactedConfig(serverConfig(s, n)),
      observed: s.secrets(n.id).observedConfig
        ? redactedConfig(s.secrets(n.id).observedConfig)
        : null,
      restartRequired: true,
    });
  });
}
