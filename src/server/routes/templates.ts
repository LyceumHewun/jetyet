import { z } from "zod";
import { digest } from "../crypto";
import { strip } from "../db";
import { render } from "../templates";
import type { Routes } from "./context";

export function registerTemplatesRoutes({
  app,
  s,
  entity,
  view,
  checked,
}: Routes) {
  app.post("/api/templates", async (c) => {
    const v = z
      .object({
        name: z.string().trim().min(1).max(100),
        body: z.string().max(100000),
      })
      .parse(await c.req.json());
    return c.json(
      s.put("template", {
        name: v.name,
        body: "",
        draft: v.body,
        published: false,
        format: "mihomo",
      }),
      201,
    );
  });

  app.put("/api/templates/:id", async (c) => {
    const t = entity(c.req.param("id"), "template"),
      v = z
        .object({
          name: z.string().trim().min(1).max(100),
          body: z.string().max(100000),
        })
        .parse(await c.req.json());
    return c.json(
      s.put(
        "template",
        { ...strip(t), name: v.name, draft: v.body },
        undefined,
        t.id,
      ),
    );
  });

  app.post("/api/templates/:id/preview", async (c) => {
    const t = entity(c.req.param("id"), "template"),
      { userId, body } = z
        .object({ userId: z.uuid(), body: z.string().max(100000).optional() })
        .parse(await c.req.json());
    const u = entity(userId, "user");
    const text = render(s, u, body ?? t.draft ?? t.body, "admin-preview");
    await checked(text);
    s.event(t.id, "template.previewed", {
      userId,
      bodyHash: digest(body ?? t.draft ?? t.body),
    });
    return c.json({ text, valid: true });
  });

  app.post("/api/templates/:id/publish", async (c) => {
    const t = entity(c.req.param("id"), "template"),
      { userId } = z.object({ userId: z.uuid() }).parse(await c.req.json());
    const u = entity(userId, "user"),
      body = t.draft ?? t.body;
    if (
      !s.db
        .query(
          "SELECT id FROM events WHERE entity=? AND type='template.previewed' AND json_extract(data,'$.bodyHash')=? AND json_extract(data,'$.userId')=? LIMIT 1",
        )
        .get(t.id, digest(body), userId)
    )
      throw Error(
        "Validate and preview this draft as the selected user before publishing",
      );
    // Validate every assigned user plus the explicit preview user before replacing a live template.
    for (const recipient of [
      u,
      ...s
        .list("user")
        .filter((u) => u.templateIds.includes(t.id) && u.id !== userId),
    ])
      await checked(render(s, recipient, body));
    const current = entity(t.id, "template");
    if (digest(current.draft ?? current.body) !== digest(body))
      throw Error("Draft changed during validation; preview and publish again");
    s.put(
      "template",
      { ...strip(current), body, draft: null, published: true },
      undefined,
      t.id,
    );
    s.event(t.id, "template.published", {});
    return c.json({ ok: true });
  });

  app.delete("/api/templates/:id", (c) => {
    const t = entity(c.req.param("id"), "template");
    if (
      t.published &&
      s.list("template").filter((t) => t.published).length === 1
    )
      throw Error(
        "Keep at least one published template so new users can be created",
      );
    if (s.list("user").some((u) => u.templateIds.includes(t.id)))
      throw Error("Template is still assigned to a user");
    s.db.query("UPDATE entities SET deleted=1 WHERE id=?").run(t.id);
    return c.json({ ok: true });
  });
}
