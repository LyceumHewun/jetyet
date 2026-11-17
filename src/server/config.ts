import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
const schema = z.object({
  origin: z.url(),
  listen: z.string().default("127.0.0.1"),
  port: z.number().int().min(1).max(65535).default(3000),
  database: z.string().default("./data/jetyet.sqlite"),
  masterKey: z.string().regex(/^[a-f0-9]{64}$/i),
  admin: z.object({
    username: z.string().min(1),
    password: z.string().min(12).optional(),
    passwordHash: z.string().optional(),
  }),
  probeUrl: z
    .url()
    .refine(
      (v) => new URL(v).protocol === "https:",
      "The proxy probe target must use HTTPS",
    )
    .default("https://www.gstatic.com/generate_204"),
  hysteriaBinary: z.string().default("/usr/local/bin/hysteria"),
  mihomoBinary: z.string().default("/usr/local/bin/mihomo"),
});
export const configPath = resolve(
  process.env.JETYET_CONFIG || "jetyet.config.json",
);
export function loadConfig(initializePassword = true) {
  const config = schema.parse(JSON.parse(readFileSync(configPath, "utf8")));
  if (!/^https?:$/.test(new URL(config.origin).protocol))
    throw Error("origin must use HTTP or HTTPS");
  const origin = new URL(config.origin);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  )
    throw Error("origin must contain only scheme, hostname, and optional port");
  config.origin = origin.origin;
  if (process.env.NODE_ENV === "production" && origin.protocol !== "https:")
    throw Error("Production origin must use HTTPS");
  if (config.admin.password) {
    if (!initializePassword)
      throw Error("Start Web first to process the administrator password");
    config.admin.passwordHash = Bun.password.hashSync(config.admin.password, {
      algorithm: "argon2id",
    });
    delete config.admin.password;
    writeFileSync(`${configPath}.tmp`, JSON.stringify(config, null, 2) + "\n", {
      mode: 0o600,
    });
    if (process.platform !== "win32") chmodSync(`${configPath}.tmp`, 0o600);
    renameSync(`${configPath}.tmp`, configPath);
    if (process.platform !== "win32") chmodSync(configPath, 0o600);
  }
  if (!config.admin.passwordHash)
    throw Error("Configure admin.password or admin.passwordHash");
  config.database = resolve(dirname(configPath), config.database);
  return config;
}
export async function loadWorkerConfig() {
  for (let i = 0; ; i++) {
    try {
      return loadConfig(false);
    } catch (err) {
      if (
        i < 10 &&
        err instanceof Error &&
        err.message === "Start Web first to process the administrator password"
      ) {
        await Bun.sleep(500);
        continue;
      }
      throw err;
    }
  }
}
export type Config = ReturnType<typeof loadConfig>;
