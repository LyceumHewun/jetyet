import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { Client } from "ssh2";
import type { Entity, Store } from "./db";
export const quote = (v: string) => "'" + v.replaceAll("'", "'\\''") + "'";
const fingerprint = (key: Buffer) =>
  "SHA256:" +
  createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
export function scanKey(host: Entity): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.destroy();
      reject(e);
    };
    const timer = setTimeout(
      () => fail(Error("SSH key scan timed out")),
      12000,
    );
    client.on("error", (e) => fail(e instanceof Error ? e : Error(String(e))));
    client.on("close", () => {
      fail(Error("SSH connection closed before host key was received"));
      client.destroy();
    });
    client.on("end", () =>
      fail(Error("SSH connection ended before host key was received")),
    );
    client.connect({
      host: host.address,
      port: host.port,
      username: host.username,
      readyTimeout: 10000,
      hostVerifier: (key: Buffer) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fingerprint(key));
        }
        return false;
      },
    });
  });
}
export async function connect(s: Store, host: Entity): Promise<Client> {
  if (!host.fingerprint) throw Error("Confirm the SSH host fingerprint first");
  const secret = s.secrets(host.id);
  return new Promise((resolve, reject) => {
    const c = new Client();
    let settled = false;
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      c.destroy();
      reject(e);
    };
    const timer = setTimeout(
      () => fail(Error("SSH connection timed out")),
      17000,
    );
    c.once("ready", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(c);
    });
    c.on("error", (e) => fail(e instanceof Error ? e : Error(String(e))));
    c.on("close", () => fail(Error("SSH connection closed before ready")));
    c.on("end", () => fail(Error("SSH connection ended before ready")));
    c.connect({
      host: host.address,
      port: host.port,
      username: host.username,
      readyTimeout: 15000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
      ...(host.authType === "key"
        ? {
            privateKey: secret.credential,
            passphrase: secret.passphrase || undefined,
          }
        : { password: secret.credential }),
      hostVerifier: (key: Buffer) => {
        const valid = fingerprint(key) === host.fingerprint;
        if (!valid)
          s.alert(
            host.id,
            "host-key",
            "SSH host key changed; confirmation required.",
          );
        return valid;
      },
    });
  });
}
export function execute(
  c: Client,
  script: string,
  root = true,
  timeout = 120000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      c.destroy();
      reject(Error("Remote command timed out"));
    }, timeout);
    c.exec(root ? "sudo -n bash -s" : "bash -s", (err, stream) => {
      if (err) {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(err);
        }
        return;
      }
      const outDec = new StringDecoder("utf8"),
        errDec = new StringDecoder("utf8");
      let out = "",
        error = "";
      stream.on("data", (v: Buffer) => {
        out += outDec.write(v);
        if (out.length > 4 * 1024 * 1024) {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            stream.close();
            reject(Error("Remote output limit exceeded"));
          }
        }
      });
      stream.stderr.on("data", (v: Buffer) => {
        error += errDec.write(v);
        if (error.length > 16384) error = error.slice(-16384);
      });
      stream.on("close", (code: number) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        out += outDec.end();
        error += errDec.end();
        if (code === 0) resolve(out);
        else
          reject(
            Error(`Remote command failed (${code}): ${error.slice(0, 1000)}`),
          );
      });
      stream.on("error", (e: Error) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(e);
      });
      stream.end(script);
    });
  });
}
export async function withHost<T>(
  s: Store,
  host: Entity,
  fn: (c: Client) => Promise<T>,
) {
  const c = await connect(s, host);
  try {
    return await fn(c);
  } finally {
    c.end();
  }
}
export async function statsApi(
  s: Store,
  node: Entity,
  path: string,
  body?: unknown,
) {
  const host = s.get(node.hostId)!;
  return withHost(s, host, async (c) => {
    const text = await execute(
      c,
      `set -euo pipefail\ncurl --fail --silent --show-error --max-time 15 -H ${quote("Authorization: " + s.secrets(node.id).statsSecret)} ${body === undefined ? "" : `-H 'Content-Type: application/json' -X POST --data ${quote(JSON.stringify(body))}`} ${quote("http://127.0.0.1:9999" + path)}\n`,
      host.username !== "root",
    );
    return text.trim() ? JSON.parse(text) : null;
  });
}
