import type { Store } from "./db";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function requireOrigin(req: Request, origin: string) {
  if (req.headers.get("origin") !== new URL(origin).origin)
    throw new HttpError(403, "Request origin mismatch");
}
export function safeError(s: Store, error: unknown) {
  let message = error instanceof Error ? error.message : "Operation failed";
  const rows = s.db
    .query<{ id: string }, []>("SELECT id FROM entities WHERE deleted=0")
    .all();
  for (const { id } of rows) {
    for (const value of Object.values(s.secrets(id))) {
      if (!value) continue;
      for (const part of [
        value,
        encodeURIComponent(value),
        ...value.split("\n").filter((v) => v.length > 15),
      ])
        message = message.replaceAll(part, "[REDACTED]");
    }
  }
  return message
    .replace(/\/auth\/hysteria\/[^\s"']+/g, "/auth/hysteria/[REDACTED]")
    .replace(/\/deploy\/[\w-]{43}\.sh/g, "/deploy/[REDACTED]")
    .slice(0, 2000);
}
