// Manual visual inspection helper; does not run test cases or contact live VPS hosts.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { sample, usage } from "../src/server/accounting";
import type { Config } from "../src/server/config";
import { token } from "../src/server/crypto";
import { storage, strip } from "../src/server/db";
import { claim, enqueue, finish } from "../src/server/tasks";

const dir = await mkdtemp(join(tmpdir(), "jetyet-preview-"));
const configPath = join(dir, "config.json");
const dbPath = join(dir, "data.sqlite");
const masterKey = randomBytes(32).toString("hex");
const password = randomBytes(20).toString("hex");

const previewConfig: Config = {
  origin: "http://localhost:3087",
  listen: "127.0.0.1",
  port: 3087,
  database: dbPath,
  masterKey,
  admin: { username: "admin", password },
  probeUrl: "https://example.com",
  hysteriaBinary: "hysteria",
  mihomoBinary: "mihomo",
};

await writeFile(configPath, JSON.stringify(previewConfig));
await mkdir(".local/screenshots", { recursive: true });

const server = spawn("bun", ["src/server/index.ts"], {
  env: { ...process.env, JETYET_CONFIG: configPath },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});

let startupError = "";
server.stderr?.on("data", (chunk) => {
  startupError += chunk;
});
server.stdout?.resume();

const exited = new Promise<void>((resolveExit) =>
  server.once("exit", () => resolveExit()),
);

function seedPreviewData() {
  const s = storage(previewConfig);
  try {
    const now = Date.now();
    const hosts = s.list("host");
    const tokyo = hosts[0];
    if (tokyo) {
      s.put(
        "host",
        {
          ...strip(tokyo),
          fingerprint: "SHA256:PreviewOnlyTokyoHostKey0123456789ABCDEF",
          reachable: true,
          cpu: 14.2,
          memory: 38.6,
          disk: 29.4,
          uptime: 432100,
          lastSeen: now,
        },
        undefined,
        tokyo.id,
      );
      s.db
        .query("UPDATE usage SET inbound=?,outbound=? WHERE id=?")
        .run(
          Math.round(78 * 1024 ** 3),
          Math.round(142 * 1024 ** 3),
          tokyo.id,
        );
      s.event(tokyo.id, "ssh.trusted", {
        fingerprint: "SHA256:PreviewOnlyTokyoHostKey0123456789ABCDEF",
      });
    }

    const frankfurt = s.put(
      "host",
      {
        name: "Frankfurt-02",
        address: "198.51.100.22",
        port: 22,
        username: "root",
        authType: "key",
        enabled: true,
        fingerprint: "SHA256:PreviewOnlyFrankfurtKey0123456789ABCDEF",
        reachable: true,
        cpu: 31.8,
        memory: 64.5,
        disk: 48.1,
        uptime: 1296000,
        lastSeen: now,
        quota: {
          limit: 1024 ** 4,
          direction: "both",
          reset: { kind: "monthly", day: 1, hour: 0 },
        },
        initialIn: 0,
        initialOut: 0,
      },
      { credential: "preview-only", passphrase: "" },
    );
    usage(s, frankfurt);
    s.db
      .query("UPDATE usage SET inbound=?,outbound=? WHERE id=?")
      .run(
        Math.round(240 * 1024 ** 3),
        Math.round(645 * 1024 ** 3),
        frankfurt.id,
      );
    s.event(frankfurt.id, "host.created", {});

    for (let i = 24; i >= 0; i--) {
      const at = now - i * 3600000;
      const wave = Math.sin(i / 3) * 0.5 + 0.5;
      if (tokyo) {
        sample(
          s,
          tokyo.id,
          at,
          Math.round((45 + wave * 80) * 1024 ** 2),
          Math.round((95 + wave * 140) * 1024 ** 2),
          {
            reachable: 1,
            cpu: 12 + wave * 24,
            memory: 36 + wave * 10,
            disk: 29.4,
          },
        );
      }
      sample(
        s,
        frankfurt.id,
        at,
        Math.round((80 + wave * 110) * 1024 ** 2),
        Math.round((180 + wave * 210) * 1024 ** 2),
        {
          reachable: 1,
          cpu: 24 + wave * 35,
          memory: 58 + wave * 12,
          disk: 48.1,
        },
      );
    }

    const template = s.list("template")[0];
    const user1Id = crypto.randomUUID();
    const user2Id = crypto.randomUUID();

    const node1 = s.put(
      "node",
      {
        hostId: frankfurt.id,
        name: "DE · Frankfurt",
        address: "203.0.113.22",
        port: 443,
        hopping: "20000-50000",
        hopInterval: 30,
        upMbps: 200,
        downMbps: 500,
        enabled: true,
        status: "ready",
        service: true,
        probe: "healthy",
        probed: now - 45000,
        version: "v2.6.5",
        drift: false,
        online: { [user1Id]: 2, [user2Id]: 1 },
      },
      { authSecret: token(), statsSecret: token(), probeToken: token() },
    );

    const node2 = tokyo
      ? s.put(
          "node",
          {
            hostId: tokyo.id,
            name: "JP · Tokyo",
            address: "198.51.100.10",
            port: 443,
            hopping: "",
            hopInterval: 30,
            upMbps: 0,
            downMbps: 0,
            enabled: true,
            status: "ready",
            service: true,
            probe: "healthy",
            probed: now - 55000,
            version: "v2.6.4",
            drift: true,
            online: { [user1Id]: 1 },
          },
          { authSecret: token(), statsSecret: token(), probeToken: token() },
        )
      : null;

    const assignedNodes = node2 ? [node1.id, node2.id] : [node1.id];

    const u1 = s.put(
      "user",
      {
        name: "Alex",
        note: "Laptop & phone",
        enabled: true,
        expires: null,
        quota: {
          limit: 120 * 1024 ** 3,
          direction: "both",
          reset: { kind: "monthly", day: 1, hour: 0 },
        },
        nodeIds: assignedNodes,
        templateIds: template ? [template.id] : [],
        defaultTemplate: template?.id || "",
      },
      { vpnToken: token(), subscriptionToken: token() },
      user1Id,
    );
    usage(s, u1);
    s.db
      .query("UPDATE usage SET inbound=?,outbound=? WHERE id=?")
      .run(Math.round(14 * 1024 ** 3), Math.round(32 * 1024 ** 3), u1.id);

    const u2 = s.put(
      "user",
      {
        name: "Maya",
        note: "Shared iPad",
        enabled: true,
        expires: new Date(now + 14 * 86400000).toISOString(),
        quota: {
          limit: 60 * 1024 ** 3,
          direction: "out",
          reset: { kind: "interval", days: 30, anchor: new Date(now).toISOString() },
        },
        nodeIds: [node1.id],
        templateIds: template ? [template.id] : [],
        defaultTemplate: template?.id || "",
      },
      { vpnToken: token(), subscriptionToken: token() },
      user2Id,
    );
    usage(s, u2);
    s.db
      .query("UPDATE usage SET inbound=?,outbound=? WHERE id=?")
      .run(Math.round(8 * 1024 ** 3), Math.round(62 * 1024 ** 3), u2.id);

    const u3 = s.put(
      "user",
      {
        name: "Sam",
        note: "Travel spare",
        enabled: true,
        expires: null,
        quota: {
          limit: null,
          direction: "both",
          reset: { kind: "monthly", day: 15, hour: 0 },
        },
        nodeIds: assignedNodes,
        templateIds: template ? [template.id] : [],
        defaultTemplate: template?.id || "",
      },
      { vpnToken: token(), subscriptionToken: token() },
    );
    usage(s, u3);
    s.db
      .query("UPDATE usage SET inbound=?,outbound=? WHERE id=?")
      .run(Math.round(3 * 1024 ** 3), Math.round(9 * 1024 ** 3), u3.id);

    enqueue(s, frankfurt.id, "deploy", {
      nodeId: node1.id,
      version: "v2.6.5",
    });
    const okTask = claim(s, false, "preview")!;
    finish(s, okTask, "succeeded");
    s.db
      .query("INSERT INTO task_logs(task,message,at) VALUES(?,?,?)")
      .run(
        okTask.id,
        "Verified Hysteria 2 v2.6.5 binary and systemd unit",
        now - 60000,
      );

    if (tokyo && node2) {
      enqueue(s, tokyo.id, "upgrade", {
        nodeId: node2.id,
        version: "v2.6.5",
      });
      const failTask = claim(s, false, "preview")!;
      finish(s, failTask, "failed", "SSH handshake timed out during check");
      s.db
        .query("INSERT INTO task_logs(task,message,at) VALUES(?,?,?)")
        .run(
          failTask.id,
          "Connecting to 198.51.100.10:22 as root (preview simulation)",
          now - 180000,
        );
    }

    s.db
      .query("INSERT OR REPLACE INTO heartbeats(name,at) VALUES(?,?)")
      .run("monitor", now);
    s.db
      .query("INSERT OR REPLACE INTO heartbeats(name,at) VALUES(?,?)")
      .run("operations", now);

    if (node2) {
      s.alert(
        node2.id,
        "configuration-drift",
        "Remote config differs from desired platform settings on JP · Tokyo.",
      );
    }
    s.alert(
      frankfurt.id,
      "ssh-unreachable",
      "Temporary SSH reachability blip observed during maintenance.",
    );
    s.resolveAlert(frankfurt.id, "ssh-unreachable");
    s.db.query("UPDATE alerts SET seen=1 WHERE closed IS NOT NULL").run();
  } finally {
    s.db.close();
  }
}

const browser = await chromium.launch({ timeout: 30000 });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  const overflowChecks: Array<{ label: string; width: number; scrollWidth: number }> = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("Page error:", e.message);
  });

  const recordOverflow = async (label: string, width: number) => {
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    overflowChecks.push({ label, width, scrollWidth });
  };

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

  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  await page.screenshot({
    path: ".local/screenshots/login-desktop.png",
    fullPage: true,
  });
  await recordOverflow("login", 1440);

  // Verify password visibility toggle & error alert before signing in
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  const pwdType = await page
    .getByLabel("Password", { exact: true })
    .getAttribute("type");
  if (pwdType !== "text") throw Error("Password reveal toggle did not switch type");
  await page.getByRole("button", { name: "Hide password", exact: true }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("alert").waitFor();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({
    path: ".local/screenshots/login-mobile.png",
    fullPage: true,
  });
  await recordOverflow("login", 375);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("heading", { name: "Your network, at a glance." })
    .waitFor();
  await sleep(450);
  await page.screenshot({
    path: ".local/screenshots/overview-empty-desktop.png",
    fullPage: true,
  });

  // Real workflow: open Add VPS form, verify desktop & 320px layout, submit synthetic VPS
  await page.getByRole("button", { name: "Add VPS", exact: true }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.waitFor();
  await sleep(350);
  await page.screenshot({
    path: ".local/screenshots/host-form-desktop.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 320, height: 800 });
  await sleep(150);
  await page.screenshot({
    path: ".local/screenshots/host-form-320.png",
    fullPage: true,
  });
  await recordOverflow("host-form", 320);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await dialog.getByLabel("Display name", { exact: true }).fill("Tokyo-01");
  await dialog.getByLabel("SSH address", { exact: true }).fill("198.51.100.10");
  await dialog.getByRole("textbox", { name: "Private key", exact: true }).fill("-----BEGIN PREVIEW KEY-----\npreview-only\n-----END PREVIEW KEY-----");
  await dialog.getByLabel("Limit", { exact: true }).fill("500");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await dialog.waitFor({ state: "detached" });

  // Verify toast notification appears and dismiss it cleanly
  await page.getByRole("button", { name: "Dismiss notification" }).waitFor();
  await page.getByRole("button", { name: "Dismiss notification" }).click();

  // Seed rich preview records into temp SQLite and refresh UI
  seedPreviewData();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await sleep(450);

  // Overview responsive check across desktop & mobile widths
  await page.screenshot({
    path: ".local/screenshots/overview-desktop.png",
    fullPage: true,
  });
  await recordOverflow("overview", 1440);

  for (const [w, h] of [
    [320, 800],
    [375, 812],
    [414, 896],
    [768, 1000],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(200);
    await page.screenshot({
      path: `.local/screenshots/overview-${w}.png`,
      fullPage: true,
    });
    await recordOverflow("overview", w);
  }

  await page.setViewportSize({ width: 1440, height: 1000 });

  // Inspect all 6 remaining views on desktop and mobile 375px
  const screens: Array<{ nav: string; file: string }> = [
    { nav: "VPS", file: "vps" },
    { nav: "Nodes", file: "nodes" },
    { nav: "Users", file: "users" },
    { nav: "Templates", file: "templates" },
    { nav: "Operations", file: "operations" },
    { nav: "Alerts", file: "alerts" },
  ];

  for (const { nav, file } of screens) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator(".sidebar-nav").getByRole("button", { name: new RegExp(`^${nav}`) }).click();
    await sleep(420);
    await page.screenshot({
      path: `.local/screenshots/${file}-desktop.png`,
      fullPage: true,
    });
    await recordOverflow(file, 1440);

    await page.setViewportSize({ width: 375, height: 812 });
    await sleep(200);
    await page.screenshot({
      path: `.local/screenshots/${file}-375.png`,
      fullPage: true,
    });
    await recordOverflow(file, 375);
  }

  // Test mobile navigation bar at 375px
  await page.locator(".mobile-nav").getByRole("button", { name: "Users" }).click();
  await page.getByRole("heading", { name: "Users", exact: true }).waitFor();

  // Test Subscription links Code dialog on Users
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Actions for Alex" }).click();
  await page.getByRole("button", { name: "Subscription links", exact: true }).click();
  await page.locator("dialog[open]").waitFor();
  await page.getByRole("heading", { name: /Alex · Subscription links/i }).waitFor();
  await page.keyboard.press("Escape");
  await page.locator("dialog[open]").waitFor({ state: "detached" });

  // Test search + empty-search + clear search on VPS
  await page.locator(".sidebar-nav").getByRole("button", { name: "VPS" }).click();
  await page.getByLabel("Search VPS", { exact: true }).fill("zzz-missing");
  await page.getByRole("heading", { name: "No matching VPS hosts" }).waitFor();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.getByRole("button", { name: "Frankfurt-02", exact: true }).waitFor();

  // Open Actions popover and screenshot
  await page.getByRole("button", { name: "Actions for Frankfurt-02" }).click();
  await sleep(320);
  await page.screenshot({
    path: ".local/screenshots/actions-popover-desktop.png",
    fullPage: true,
  });

  // Open History dialog from popover and verify charts
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.locator("dialog[open]").waitFor();
  await page.locator(".recharts-surface").first().waitFor();
  await sleep(650);
  await page.screenshot({
    path: ".local/screenshots/history-dialog-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await sleep(250);
  await page.screenshot({
    path: ".local/screenshots/history-dialog-375.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.locator("dialog[open]").waitFor({ state: "detached" });

  // Open destructive Confirm dialog & verify safe initial focus on Cancel
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Actions for Frankfurt-02" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.locator("dialog[open]").waitFor();
  await sleep(320);
  const activeTagText = await page.evaluate(
    () => document.activeElement?.textContent?.trim() || "",
  );
  if (activeTagText !== "Cancel") {
    throw Error(`Expected initial focus on Cancel, got: ${activeTagText}`);
  }
  await page.screenshot({
    path: ".local/screenshots/confirm-dialog-desktop.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.locator("dialog[open]").waitFor({ state: "detached" });

  // Open TemplateEditor
  await page.locator(".sidebar-nav").getByRole("button", { name: "Templates" }).click();
  await page.getByRole("button", { name: /Everyday/i }).click();
  await page.locator("dialog[open]").waitFor();
  await sleep(350);
  await page.screenshot({
    path: ".local/screenshots/template-editor-desktop.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.locator("dialog[open]").waitFor({ state: "detached" });

  // Verify reduced-motion never leaves elements invisible
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".sidebar-nav").getByRole("button", { name: "Overview" }).click();
  await sleep(100);
  const reducedOpacity = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const stat = document.querySelector(".stat");
    return {
      h1: h1 ? getComputedStyle(h1).opacity : null,
      stat: stat ? getComputedStyle(stat).opacity : null,
    };
  });
  if (reducedOpacity.h1 !== "1" || reducedOpacity.stat !== "1") {
    throw Error(`Reduced motion left opacity != 1: ${JSON.stringify(reducedOpacity)}`);
  }

  const overflows = overflowChecks.filter((c) => c.scrollWidth > c.width);
  if (overflows.length) {
    throw Error(`Horizontal overflow detected: ${JSON.stringify(overflows)}`);
  }
  if (errors.length) {
    throw Error(`Uncaught page errors: ${JSON.stringify(errors)}`);
  }

  console.log(
    JSON.stringify(
      {
        overflowChecks,
        reducedOpacity,
        pageErrors: errors,
        screenshots: resolve(".local/screenshots"),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  server.kill();
  await exited;
  const base = resolve(tmpdir()) + sep + "jetyet-preview-";
  if (!resolve(dir).startsWith(base)) throw Error("Unexpected temporary path");
  await rm(dir, { recursive: true, force: true });
}
