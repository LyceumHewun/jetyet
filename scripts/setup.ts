import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { usernameSchema } from "../src/shared/schemas";
const path = process.env.JETYET_CONFIG || "jetyet.config.json";
if (existsSync(path))
  throw Error(
    "Configuration already exists. Edit it directly to change the database path or administrator credentials.",
  );
const username = usernameSchema.parse(
  prompt("Administrator username:", "admin"),
);
const password = prompt("Administrator password (12+ characters):");
if (!password || password.length < 12)
  throw Error("Password must contain at least 12 characters");
const production = process.env.NODE_ENV === "production";
const origin = prompt(
  "Public origin:",
  production ? undefined : "http://localhost:3000",
);
if (production && (!origin || new URL(origin).protocol !== "https:"))
  throw Error("Production origin must use HTTPS");
const defaultDatabase = production
  ? "/var/lib/jetyet/jetyet.sqlite"
  : "./data/jetyet.sqlite";
const database =
  prompt(
    production
      ? "SQLite database path (use a file under /var/lib/jetyet):"
      : "SQLite database path (relative to the configuration directory or absolute):",
    defaultDatabase,
  )?.trim() || defaultDatabase;
const databasePath = resolve(dirname(path), database);
if (production && !databasePath.startsWith("/var/lib/jetyet/"))
  throw Error("Production database must be a file under /var/lib/jetyet");
writeFileSync(
  path,
  JSON.stringify(
    {
      origin,
      listen: "127.0.0.1",
      port: 3000,
      database,
      masterKey: randomBytes(32).toString("hex"),
      admin: { username, password },
      probeUrl: "https://www.gstatic.com/generate_204",
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600, flag: "wx" },
);
console.log(`SQLite database: ${databasePath}`);
console.log(
  "Configuration created. Start Jetyet Web to replace the plaintext password with an Argon2id hash.",
);
