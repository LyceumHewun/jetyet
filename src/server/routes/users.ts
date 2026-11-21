import { z } from "zod";
import { userSchema } from "../../shared/schemas";
import { nextReset, usage, userAllowed } from "../accounting";
import { token } from "../crypto";
import { strip } from "../db";
import { HttpError } from "../errors";
import { issuePasswordLink, revokePortalAccess } from "../sign-in";
import { kickUser } from "../tasks";
import type { Routes } from "./context";

export function registerUsersRoutes({ app, s, entity, view, checked }: Routes) {
  function validateReferences(
    input: z.infer<typeof userSchema>,
    currentId?: string,
  ) {
    const existing = s.userByUsername(input.username);
    if (
      input.username === s.config.admin.username.toLowerCase() ||
      (existing && existing.id !== currentId)
    )
      throw new HttpError(409, "Sign-in username is already in use");
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
    const e = s.db
      .transaction(() => {
        validateReferences(data);
        const user = s.put("user", data, {
          vpnToken: token(),
          subscriptionToken: token(),
        });
        usage(s, user);
        s.event(user.id, "user.created", {});
        return user;
      })
      .immediate();
    return c.json(view(e), 201);
  });

  app.put("/api/users/:id", async (c) => {
    const id = c.req.param("id"),
      data = userSchema.parse(await c.req.json());
    s.db
      .transaction(() => {
        const old = entity(id, "user");
        validateReferences(data, id);
        const e = s.put("user", data, undefined, id);
        if (!e.enabled || old.username !== e.username)
          revokePortalAccess(s, id);
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
    return c.json(view(entity(id)));
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

  app.post("/api/users/:id/password-link", (c) => {
    return c.json(
      s.db
        .transaction(() => {
          const u = entity(c.req.param("id"), "user");
          if (!u.username || !u.enabled)
            throw new HttpError(
              409,
              "Enable the user and set their sign-in username first",
            );
          const link = issuePasswordLink(s, u.id);
          s.event(u.id, "portal.password-link.issued", {});
          return link;
        })
        .immediate(),
    );
  });
}
