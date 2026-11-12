import { z } from "zod";
import { userSchema } from "../../shared/schemas";
import { nextReset, usage, userAllowed } from "../accounting";
import { token } from "../crypto";
import { strip } from "../db";
import { kickUser } from "../tasks";
import type { Routes } from "./context";

export function registerUsersRoutes({ app, s, entity, view, checked }: Routes) {
  function validateReferences(input: z.infer<typeof userSchema>) {
    for (const id of input.nodeIds)
      if (entity(id, "node").deleting)
        throw Error("A node pending deletion cannot be assigned");
    for (const id of input.templateIds) {
      const t = entity(id, "template");
      if (!t.published) throw Error("Only published templates may be assigned");
    }
  }

  app.post("/api/users", async (c) => {
    const data = userSchema.parse(await c.req.json());
    validateReferences(data);
    const e = s.put("user", data, {
      vpnToken: token(),
      subscriptionToken: token(),
    });
    usage(s, e);
    s.event(e.id, "user.created", {});
    return c.json(view(e), 201);
  });

  app.put("/api/users/:id", async (c) => {
    const old = entity(c.req.param("id"), "user"),
      data = userSchema.parse(await c.req.json());
    validateReferences(data);
    s.db
      .transaction(() => {
        const e = s.put("user", data, undefined, old.id);
        if (
          JSON.stringify(old.quota.reset) !== JSON.stringify(data.quota.reset)
        )
          s.db
            .query("UPDATE usage SET next=? WHERE id=?")
            .run(nextReset(data.quota.reset, Date.now()), old.id);
        const removed = old.nodeIds.filter(
          (id: string) => !data.nodeIds.includes(id),
        );
        if (removed.length) kickUser(s, old.id, removed);
        if (!userAllowed(s, e)) kickUser(s, e.id);
        s.event(e.id, "user.updated", {});
      })
      .immediate();
    return c.json(view(entity(old.id)));
  });

  app.post("/api/users/:id/rotate", async (c) => {
    const u = entity(c.req.param("id"), "user"),
      { target } = z
        .object({ target: z.enum(["subscription", "vpn", "both"]) })
        .parse(await c.req.json());
    s.db
      .transaction(() => {
        const sec = s.secrets(u.id);
        if (target !== "vpn") sec.subscriptionToken = token();
        if (target !== "subscription") sec.vpnToken = token();
        s.put("user", strip(u), sec, u.id);
        if (target !== "subscription") kickUser(s, u.id);
        s.event(u.id, "credentials.rotated", { target });
      })
      .immediate();
    return c.json({ ok: true });
  });

  app.get("/api/users/:id/links", (c) => {
    const u = entity(c.req.param("id"), "user");
    const base = `${s.config.origin}/sub/${s.secrets(u.id).subscriptionToken}`;
    return c.json({
      default: base,
      templates: u.templateIds.map((id: string) => ({
        id,
        url: base + "?template=" + id,
      })),
    });
  });
}
