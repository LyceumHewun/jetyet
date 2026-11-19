// Persistent synthetic preview server for interactive UX review; loopback only.
import { seedPreviewWorkspace, startPreviewHarness } from "./preview-env";

const PORT = 3088;
const USERNAME = "admin";
const PASSWORD = "jetyet-preview";
const ORIGIN = `http://127.0.0.1:${PORT}`;

const harness = await startPreviewHarness({
  dirPrefix: "jetyet-live-preview-",
  origin: ORIGIN,
  port: PORT,
  password: PASSWORD,
});

await harness.waitReady(`${ORIGIN}/`);
seedPreviewWorkspace(harness.config, {
  updateExistingTokyo: false,
  includeUntrustedOsaka: true,
  loopbackSshPort: harness.sshPort,
});

const hbTimer = setInterval(() => harness.touchHeartbeats(), 15000);
hbTimer.unref?.();

console.log(
  JSON.stringify({
    url: ORIGIN,
    username: USERNAME,
    password: PASSWORD,
    loopbackSsh: `127.0.0.1:${harness.sshPort}`,
  }),
);

async function shutdown() {
  clearInterval(hbTimer);
  await harness.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await new Promise<void>((resolveExit) => {
  harness.server.once("exit", () => resolveExit());
});
await shutdown();
