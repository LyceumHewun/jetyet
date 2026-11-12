import type { Store } from "./db";
export function safeError(s: Store, error: unknown) {
  let message = error instanceof Error ? error.message : "Operation failed";
  const rows = s.db.query<{ id: string }, []>("SELECT id FROM entities").all();
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
    .slice(0, 2000);
}
