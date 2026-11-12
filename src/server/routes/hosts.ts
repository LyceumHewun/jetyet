import { z } from "zod";
import { hostSchema } from "../../shared/schemas";
import { exhausted, nextReset, usage } from "../accounting";
import { strip } from "../db";
import { scanKey } from "../ssh";
import { enqueue, kickUser } from "../tasks";
import type { Routes } from "./context";

export function registerHostsRoutes({ app, s, entity, view, checked }: Routes) {
  app.post("/api/hosts", async (c) => {
    const input = hostSchema.parse(await c.req.json());
    if (!input.credential) throw Error("SSH credential is required");
    const { credential, passphrase, ...data } = input;
    const e = s.put("host", data, { credential, passphrase });
    usage(s, e);
    s.event(e.id, "host.created", {});
    return c.json(view(e), 201);
  });

  app.put("/api/hosts/:id", async (c) => {
    const old = entity(c.req.param("id"), "host"),
      input = hostSchema.parse(await c.req.json());
    const { credential, passphrase, ...data } = input;
    const secret = s.secrets(old.id);
    if (old.authType !== data.authType && !credential)
      throw Error(
        "Supply a new credential when changing SSH authentication type",
      );
    if (credential) {
      secret.credential = credential;
      secret.passphrase = passphrase;
    }
    const changedAddress =
      old.address !== data.address || old.port !== data.port;
    s.db
      .transaction(() => {
        const e = s.put(
          "host",
          {
            ...strip(old),
            ...data,
            fingerprint: changedAddress ? null : old.fingerprint,
          },
          secret,
          old.id,
        );
        if (
          JSON.stringify(old.quota.reset) !== JSON.stringify(data.quota.reset)
        )
          s.db
            .query("UPDATE usage SET next=? WHERE id=?")
            .run(nextReset(data.quota.reset, Date.now()), old.id);
        if (old.enabled !== e.enabled) enqueue(s, e.id, "host-state");
        for (const n of s.list("node").filter((n) => n.hostId === e.id))
          if (exhausted(s, e) || !e.enabled)
            for (const u of s.list("user"))
              if (u.nodeIds.includes(n.id)) kickUser(s, u.id, [n.id]);
        s.event(e.id, "host.updated", {});
      })
      .immediate();
    return c.json(view(entity(old.id)));
  });

  app.post("/api/hosts/:id/fingerprint", async (c) => {
    const e = entity(c.req.param("id"), "host");
    return c.json({ fingerprint: await scanKey(e) });
  });

  app.post("/api/hosts/:id/trust", async (c) => {
    const e = entity(c.req.param("id"), "host");
    const { fingerprint } = z
      .object({ fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]+$/) })
      .parse(await c.req.json());
    const actual = await scanKey(e);
    if (actual !== fingerprint)
      throw Error("Fingerprint changed during confirmation; inspect again");
    s.put("host", { ...strip(e), fingerprint }, undefined, e.id);
    s.resolveAlert(e.id, "host-key");
    s.event(e.id, "ssh.trusted", { fingerprint });
    return c.json({ ok: true });
  });
}
