import { z } from "zod";
import { nodeSchema } from "../../shared/schemas";
import { token } from "../crypto";
import { strip } from "../db";
import { deploymentScript, redactedConfig, serverConfig } from "../deployment";
import { enqueue } from "../tasks";
import { templateGroupNames } from "../templates";
import type { Routes } from "./context";

export function registerNodesRoutes({ app, s, entity, view, checked }: Routes) {
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
    if (n.deleting)
      throw Error("A node pending deletion cannot run operations");
    const { kind, version } = z
      .object({
        kind: z.enum(["deploy", "detect", "upgrade", "reapply"]),
        version: z
          .string()
          .regex(/^v2\.\d+\.\d+$/)
          .optional(),
      })
      .parse(await c.req.json());
    if (kind !== "detect" && !version)
      throw Error("An explicit version is required");
    const id = enqueue(s, n.hostId, kind, { nodeId: n.id, version });
    return c.json({ id }, 202);
  });

  app.post("/api/nodes/:id/command", async (c) => {
    const n = entity(c.req.param("id"), "node");
    const { version } = z
      .object({ version: z.string().regex(/^v2\.\d+\.\d+$/) })
      .parse(await c.req.json());
    return c.json({ script: deploymentScript(s, n, version) });
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
