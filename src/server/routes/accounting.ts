import { z } from "zod";
import { exhausted, resetUsage, usage } from "../accounting";
import { kickUser } from "../tasks";
import type { Routes } from "./context";

export function registerAccountingRoutes({
  app,
  s,
  entity,
  view,
  checked,
}: Routes) {
  app.post("/api/usage/:id/reset", (c) => {
    const e = entity(c.req.param("id"));
    if (!["host", "user"].includes(e.kind))
      throw Error("Invalid traffic owner");
    s.db.transaction(() => resetUsage(s, e, true)).immediate();
    return c.json(usage(s, e));
  });

  app.post("/api/hosts/:id/correct", async (c) => {
    const e = entity(c.req.param("id"), "host"),
      v = z
        .object({
          inbound: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          outbound: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          reason: z.string().trim().min(1).max(1000),
        })
        .parse(await c.req.json());
    s.db
      .transaction(() => {
        s.event(e.id, "traffic.corrected", { before: usage(s, e), after: v });
        s.db
          .query("UPDATE usage SET inbound=?,outbound=? WHERE id=?")
          .run(v.inbound, v.outbound, e.id);
        if (exhausted(s, e))
          for (const n of s.list("node").filter((n) => n.hostId === e.id))
            for (const u of s.list("user")) kickUser(s, u.id, [n.id]);
      })
      .immediate();
    return c.json({ ok: true });
  });
}
