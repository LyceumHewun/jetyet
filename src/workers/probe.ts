import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  MIN_ECH_VERSION,
  MIN_PINNED_TLS_VERSION,
  compareHysteriaVersion,
} from "../shared/tls";
import { hasEch, hasPinnedTls } from "../server/subscriptions";
import type { Entity, Store } from "../server/db";

const probeBinaryVersions = new Map<string, string>();

async function resolveExecutable(
  binary: string,
): Promise<{ path: string; identity: string }> {
  const located = binary.includes("/") ? binary : Bun.which(binary);
  if (!located) throw Error("Management host Hysteria 2 binary was not found");
  const resolved = await realpath(located);
  const st = await stat(resolved);
  return {
    path: resolved,
    identity: `${resolved}:${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}`,
  };
}

async function verifiedProbeBinary(
  binary: string,
  pinned: boolean,
  ech: boolean,
): Promise<{ path: string; identity: string }> {
  const exec = await resolveExecutable(binary);
  if (!pinned) return exec;
  let version = probeBinaryVersions.get(exec.identity);
  if (!version) {
    const proc = Bun.spawn([exec.path, "version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const outPromise = new Response(proc.stdout).text();
    const errPromise = new Response(proc.stderr).text();
    const timedOut = await Promise.race([
      proc.exited.then(() => false),
      Bun.sleep(5000).then(() => true),
    ]);
    if (timedOut) {
      await stopChild(proc);
      await Promise.allSettled([outPromise, errPromise]);
      throw Error(
        "Timed out checking management host Hysteria 2 binary version",
      );
    }
    const [out] = await Promise.all([outPromise, errPromise]);
    const match = proc.exitCode === 0 ? out.match(/\bv2\.\d+\.\d+\b/) : null;
    if (!match)
      throw Error(
        "Unable to determine management host Hysteria 2 binary version",
      );
    const after = await resolveExecutable(binary);
    if (after.identity !== exec.identity)
      throw Error(
        "Management host Hysteria 2 binary changed during version verification",
      );
    version = match[0];
    probeBinaryVersions.set(exec.identity, version);
  }
  if (compareHysteriaVersion(version, MIN_PINNED_TLS_VERSION) < 0)
    throw Error(
      "Management host Hysteria 2 binary must be v2.6.4 or later to probe pinned nodes",
    );
  if (ech && compareHysteriaVersion(version, MIN_ECH_VERSION) < 0)
    throw Error(
      "Management host Hysteria 2 binary must be v2.12.3 or later to probe ECH nodes",
    );
  return exec;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((res, rej) => {
    server.once("error", rej);
    server.listen(0, "127.0.0.1", res);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((res) => server.close(() => res()));
  return port;
}
async function stopChild(child: ReturnType<typeof Bun.spawn>) {
  if (child.exitCode !== null) return;
  child.kill();
  const exited = await Promise.race([
    child.exited.then(() => true),
    Bun.sleep(3000).then(() => false),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill(9);
    await child.exited;
  }
}
export async function probeNode(s: Store, n: Entity) {
  const pinned = hasPinnedTls(n);
  const ech = hasEch(n);
  const exec = await verifiedProbeBinary(s.config.hysteriaBinary, pinned, ech);
  const dir = await mkdtemp(join(tmpdir(), "jetyet-probe-"));
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const path = join(dir, "config.yaml"),
      address = n.address.includes(":") ? `[${n.address}]` : n.address;
    const tls = pinned
      ? {
          sni: n.sni,
          insecure: true,
          pinSHA256: n.certSha256,
          ...(ech ? { ech: n.echConfig } : {}),
        }
      : { insecure: true };
    let port = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      port = await freePort();
      await writeFile(
        path,
        YAML.stringify({
          server: `${address}:${n.port}`,
          auth: s.secrets(n.id).probeToken,
          tls,
          socks5: { listen: `127.0.0.1:${port}` },
        }),
        { mode: 0o600 },
      );
      if (pinned) {
        const currentExec = await resolveExecutable(s.config.hysteriaBinary);
        if (currentExec.identity !== exec.identity)
          throw Error(
            "Management host Hysteria 2 binary changed before probe launch",
          );
      }
      child = Bun.spawn([exec.path, "client", "-c", path], {
        stdout: "ignore",
        stderr: "ignore",
      });
      await Bun.sleep(700);
      if (child.exitCode === null) break;
      await stopChild(child);
      child = undefined;
      if (attempt === 1) throw Error("Probe client exited");
    }
    let ok = false;
    for (let i = 0; i < 5; i++) {
      if (i > 0) await Bun.sleep(700);
      if (!child || child.exitCode !== null) throw Error("Probe client exited");
      const req = Bun.spawn(
        [
          "curl",
          "--fail",
          "--silent",
          "--show-error",
          "--max-time",
          "8",
          "--socks5-hostname",
          "127.0.0.1:" + port,
          "--noproxy",
          "",
          s.config.probeUrl,
        ],
        { stdout: "ignore", stderr: "ignore" },
      );
      if ((await req.exited) === 0) {
        ok = true;
        break;
      }
    }
    if (!ok) throw Error("Proxy HTTPS probe failed");
  } finally {
    if (child) await stopChild(child);
    await rm(dir, { recursive: true, force: true });
  }
}
