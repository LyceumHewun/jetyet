import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { usernameSchema } from "../src/shared/schemas";
const path = process.env.JETYET_CONFIG || "jetyet.config.json";
if (existsSync(path))
  throw Error(
    "Configuration already exists; edit it directly to change administrator credentials.",
  );
const username = usernameSchema.parse(
  prompt("Administrator username:", "admin"),
);
const password = prompt("Administrator password (12+ characters):");
if (!password || password.length < 12)
  throw Error("Password must contain at least 12 characters");
writeFileSync(
  path,
  JSON.stringify(
    {
      origin: prompt("Public origin:", "http://localhost:3000"),
      listen: "127.0.0.1",
      port: 3000,
      database: "./data/jetyet.sqlite",
      masterKey: randomBytes(32).toString("hex"),
      admin: { username, password },
      probeUrl: "https://www.gstatic.com/generate_204",
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Configuration created. Run bun start; the plaintext password will be replaced with an Argon2id hash.",
);
