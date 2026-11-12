// Manual visual inspection helper; does not run test cases or contact VPS hosts.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
const dir = await mkdtemp(join(tmpdir(), "jetyet-preview-"));
const path = join(dir, "config.json"),
  password = randomBytes(20).toString("hex");
await writeFile(
  path,
  JSON.stringify({
    origin: "http://localhost:3087",
    listen: "127.0.0.1",
    port: 3087,
    database: join(dir, "data.sqlite"),
    masterKey: randomBytes(32).toString("hex"),
    admin: { username: "admin", password },
  }),
);
await mkdir(".local/screenshots", { recursive: true });
const server = spawn("bun", ["src/server/index.ts"], {
  env: { ...process.env, JETYET_CONFIG: path },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let startupError = "";
server.stderr?.on("data", (chunk) => {
  startupError += chunk;
});
server.stdout?.resume();
const exited = new Promise<void>((resolve) =>
  server.once("exit", () => resolve()),
);
const browser = await chromium.launch({ timeout: 30000 });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("Page error:", e.message);
  });
  for (let i = 0; i < 40; i++) {
    if (server.exitCode !== null) throw Error(startupError);
    try {
      await page.goto("http://localhost:3087", {
        waitUntil: "domcontentloaded",
        timeout: 10000,
      });
      break;
    } catch {
      await sleep(300);
    }
  }
  await page.screenshot({
    path: ".local/screenshots/initial-render.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  await page.screenshot({
    path: ".local/screenshots/login-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("heading", { name: "Your network, at a glance." })
    .waitFor();
  await page.screenshot({
    path: ".local/screenshots/overview-desktop.png",
    fullPage: true,
  });
  const widths = [];
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `.local/screenshots/overview-${width}.png`,
      fullPage: true,
    });
    widths.push({
      width,
      content: await page.evaluate(() => document.documentElement.scrollWidth),
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Add VPS", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.screenshot({
    path: ".local/screenshots/host-form-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.screenshot({
    path: ".local/screenshots/host-form-320.png",
    fullPage: true,
  });
  console.log(
    JSON.stringify({
      widths,
      pageErrors: errors,
      screenshots: resolve(".local/screenshots"),
    }),
  );
} finally {
  await browser.close();
  server.kill();
  await exited;
  const base = resolve(tmpdir()) + sep + "jetyet-preview-";
  if (!resolve(dir).startsWith(base)) throw Error("Unexpected temporary path");
  await rm(dir, { recursive: true, force: true });
}
