import {
  chmod,
  copyFile,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
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

async function snapshotProbeBinary(
  binary: string,
  dir: string,
): Promise<string> {
  const located = binary.includes("/") ? binary : Bun.which(binary);
  if (!located) throw Error("Management host Hysteria 2 binary was not found");
  const resolved = await realpath(located);
  const snapshot = join(dir, "hysteria");
  await copyFile(resolved, snapshot);
  await chmod(snapshot, 0o500);
  return snapshot;
}

async function verifySnapshotVersion(
  snapshot: string,
  pinned: boolean,
  ech: boolean,
) {
  if (!pinned) return;
  const proc = Bun.spawn([snapshot, "version"], {
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
    throw Error("Unable to determine management host Hysteria 2 binary version");
  const version = match[0];
  if (compareHysteriaVersion(version, MIN_PINNED_TLS_VERSION) < 0)
    throw Error(
      "Management host Hysteria 2 binary must be v2.6.4 or later to probe pinned nodes",
    );
  if (ech && compareHysteriaVersion(version, MIN_ECH_VERSION) < 0)
    throw Error(
      "Management host Hysteria 2 binary must be v2.12.3 or later to probe ECH nodes",
    );
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
  const dir = await mkdtemp(join(tmpdir(), "jetyet-probe-"));
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const snapshot = await snapshotProbeBinary(s.config.hysteriaBinary, dir);
    await verifySnapshotVersion(snapshot, pinned, ech);
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
      child = Bun.spawn([snapshot, "client", "-c", path], {
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
