// Manual visual inspection & workflow walkthrough; synthetic loopback data only.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { seedPreviewWorkspace, startPreviewHarness } from "./preview-env";

await mkdir(".local/screenshots", { recursive: true });
const harness = await startPreviewHarness({
  dirPrefix: "jetyet-preview-",
  origin: "http://localhost:3087",
  port: 3087,
});

const browser = await chromium.launch({ timeout: 30000 });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const errors: string[] = [];
  const overflowChecks: Array<{
    label: string;
    width: number;
    scrollWidth: number;
  }> = [];
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

  await harness.waitReady("http://localhost:3087/");
  await page.goto("http://localhost:3087", {
    waitUntil: "domcontentloaded",
    timeout: 10000,
  });

  // 1. Login desktop & mobile + password reveal + bad password alert
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  await page.screenshot({
    path: ".local/screenshots/login-desktop.png",
    fullPage: true,
  });
  await recordOverflow("login", 1440);

  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  const pwdType = await page
    .getByLabel("Password", { exact: true })
    .getAttribute("type");
  if (pwdType !== "text") {
    throw Error("Password toggle did not switch type to text");
  }
  await page.getByRole("button", { name: "Hide password", exact: true }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("alert").waitFor();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({
    path: ".local/screenshots/login-375.png",
    fullPage: true,
  });
  await recordOverflow("login", 375);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Password", { exact: true }).fill(harness.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("heading", { name: /Bring your first/i })
    .waitFor();
  await sleep(300);
  await page.screenshot({
    path: ".local/screenshots/overview-empty-desktop.png",
    fullPage: true,
  });

  // 2. Guided Onboarding Walkthrough:
  // Validation error -> unreachable SSH failure -> edit SSH -> scan local ssh2 server ->
  // explicit trust checkbox gate -> plan node -> manual deploy script -> SSH deploy -> real queued state
  await page.getByRole("link", { name: "Onboard VPS" }).click();
  await page.getByRole("heading", { name: /1\. Add VPS connection/i }).waitFor();

  // Failure path: submit empty host form
  await page
    .getByRole("button", { name: /Save VPS & verify SSH key/i })
    .click();
  const nameInvalid = await page
    .getByLabel("Display name", { exact: true })
    .evaluate((el: HTMLInputElement) => el.validity.valueMissing);
  if (!nameInvalid) throw Error("Expected required display name validation");

  // Fill unreachable loopback port first to test SSH scan error & edit recovery
  await page.getByLabel("Display name", { exact: true }).fill("Tokyo-01");
  await page.getByLabel("SSH address", { exact: true }).fill("127.0.0.1");
  await page.getByLabel("SSH port", { exact: true }).fill("1");
  await page
    .getByRole("textbox", { name: "Private key", exact: true })
    .fill(
      "-----BEGIN PREVIEW KEY-----\npreview-only\n-----END PREVIEW KEY-----",
    );
  await page.getByLabel("Limit", { exact: true }).fill("500");
  await page
    .getByRole("button", { name: /Save VPS & verify SSH key/i })
    .click();

  await page
    .getByRole("heading", { name: /2\. Verify & trust SSH fingerprint/i })
    .waitFor();
  await page.getByRole("button", { name: /Scan SSH host key/i }).click();
  await page.locator(".error-panel[role='alert']").waitFor();

  // Recover by editing SSH port to local loopback ssh2 server
  await page.getByRole("button", { name: /Edit SSH connection/i }).click();
  await page.getByLabel("SSH port", { exact: true }).fill(String(harness.sshPort));
  await page.getByRole("button", { name: /Save & inspect SSH key/i }).click();
  await page
    .getByRole("heading", { name: /2\. Verify & trust SSH fingerprint/i })
    .waitFor();
  await page.getByRole("button", { name: /Scan SSH host key/i }).click();

  // Assert trust button is disabled until explicit confirmation checkbox is checked
  const trustBtn = page.getByRole("button", { name: "Trust fingerprint" });
  await trustBtn.waitFor();
  if (!(await trustBtn.isDisabled())) {
    throw Error("Trust fingerprint button must stay disabled until confirmed");
  }
  await page.locator(".fingerprint-review input[type='checkbox']").check();
  if (await trustBtn.isDisabled()) {
    throw Error("Trust fingerprint button stayed disabled after checking confirmation");
  }
  await trustBtn.click();

  // Step 3: Plan node
  await page
    .getByRole("heading", { name: /3\. Plan Hysteria 2 node/i })
    .waitFor();
  await page
    .getByLabel("Advertised IP address", { exact: true })
    .fill("198.51.100.10");
  await page
    .getByRole("button", { name: /Save node plan & continue/i })
    .click();
  await page
    .getByRole("heading", { name: /3\. Deploy Tokyo-01/i })
    .waitFor();

  // Check manual command path
  await page.getByRole("tab", { name: /Manual command & detect/i }).click();
  await page.getByRole("button", { name: /Generate deploy script/i }).click();
  await page.locator(".terminal-card .terminal-body").waitFor();

  // Switch back to Platform SSH deploy and queue real operation
  await page.getByRole("tab", { name: /Platform SSH deploy/i }).click();
  await page.getByRole("button", { name: /Queue SSH deployment/i }).click();
  await page.getByRole("heading", { name: /4\. Operation status/i }).waitFor();
  await page.getByText("Queued for worker").waitFor();
  await sleep(300);
  await page.screenshot({
    path: ".local/screenshots/onboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await sleep(200);
  await page.screenshot({
    path: ".local/screenshots/onboard-375.png",
    fullPage: true,
  });
  await recordOverflow("onboard", 375);

  // 3. Seed rich preview data & inspect all views on wide and narrow widths
  await page.setViewportSize({ width: 1440, height: 1000 });
  seedPreviewWorkspace(harness.config, { updateExistingTokyo: true });
  await page.getByRole("button", { name: "Refresh workspace state" }).click();
  const toastClose = page.locator(".toast-close");
  if (await toastClose.count()) {
    await toastClose.first().click();
  }
  await sleep(350);

  const sectionChecks: Array<{ nav: string; file: string }> = [
    { nav: "Overview", file: "overview" },
    { nav: "VPS", file: "vps" },
    { nav: "Nodes", file: "nodes" },
    { nav: "Users", file: "users" },
    { nav: "Templates", file: "templates" },
    { nav: "Operations", file: "operations" },
    { nav: "Alerts", file: "alerts" },
  ];

  for (const { nav, file } of sectionChecks) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .locator(".top-bar")
      .getByRole("link", { name: new RegExp(`^${nav}`, "i") })
      .click();
    await sleep(350);
    await page.screenshot({
      path: `.local/screenshots/${file}-desktop.png`,
      fullPage: true,
    });
    await recordOverflow(file, 1440);

    await page.setViewportSize({ width: 375, height: 812 });
    await sleep(220);
    await page.screenshot({
      path: `.local/screenshots/${file}-375.png`,
      fullPage: true,
    });
    await recordOverflow(file, 375);
  }

  for (const w of [320, 768] as const) {
    await page.setViewportSize({ width: w, height: 860 });
    await page
      .locator(".top-bar")
      .getByRole("link", { name: "Jetyet Overview" })
      .click();
    await sleep(200);
    await recordOverflow("overview", w);
  }

  // 4. Mobile list-to-detail drill-down + Back button + browser back history
  await page.setViewportSize({ width: 375, height: 812 });
  await page
    .locator(".mobile-dock")
    .getByRole("link", { name: "VPS", exact: true })
    .click();
  await page.locator(".selector-card", { hasText: "Frankfurt-02" }).click();
  await page.getByRole("button", { name: "Back to VPS" }).waitFor();
  await page
    .locator(".detail-hero-card h2", { hasText: "Frankfurt-02" })
    .waitFor();
  await sleep(350);
  await page.screenshot({
    path: ".local/screenshots/vps-detail-375.png",
    fullPage: true,
  });
  await recordOverflow("vps-detail", 375);

  // Back button returns to list
  await page.getByRole("button", { name: "Back to VPS" }).click();
  await page.getByRole("button", { name: "Back to VPS" }).waitFor({ state: "detached" });

  // Browser history back works too
  await page.locator(".selector-card", { hasText: "Frankfurt-02" }).click();
  await page.getByRole("button", { name: "Back to VPS" }).waitFor();
  await page.goBack();
  await page.getByRole("button", { name: "Back to VPS" }).waitFor({ state: "detached" });

  // 5. VPS History charts + Archive check
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".selector-card", { hasText: "Frankfurt-02" }).click();
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await page.locator(".recharts-surface").first().waitFor();
  await sleep(500);
  await page.screenshot({
    path: ".local/screenshots/vps-history-desktop.png",
    fullPage: true,
  });

  await page.getByRole("tab", { name: "Archive", exact: true }).click();
  await page.locator(".selector-card", { hasText: "Archive-Singapore" }).waitFor();

  // 6. User -> direct subscription copy + inline node authorization save
  await page
    .locator(".top-bar")
    .getByRole("link", { name: "Users", exact: true })
    .click();
  await page.locator(".selector-card", { hasText: "Alex" }).click();
  const copySubBtn = page.getByRole("button", {
    name: "Copy subscription link",
    exact: true,
  });
  await copySubBtn.waitFor();
  await copySubBtn.click();
  await page.getByRole("button", { name: "Copied link", exact: true }).waitFor();

  const mayaNodeToggle = page.locator(".check-card", { hasText: "JP · Tokyo" }).locator("input");
  await mayaNodeToggle.uncheck();
  await page.getByRole("button", { name: "Save access changes", exact: true }).click();
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await mayaNodeToggle.check();
  await page.getByRole("button", { name: "Save access changes", exact: true }).click();
  await page.getByRole("button", { name: "Dismiss notification" }).click();

  // 7. Template Studio: validation failure path -> valid preview path
  await page
    .locator(".top-bar")
    .getByRole("link", { name: "Templates", exact: true })
    .click();
  const editor = page.getByLabel("Liquid template (YAML)", { exact: true });
  const originalYaml = await editor.inputValue();
  await editor.fill("mixed-port: 7890\nproxies: []\n");
  await page.getByRole("button", { name: "Validate & preview", exact: true }).click();
  await page.locator(".form-error[role='alert']").waitFor();

  await editor.fill(originalYaml);
  await page.getByRole("button", { name: "Validate & preview", exact: true }).click();
  await page.getByText("Validated · credentials hidden").waitFor();
  await page.screenshot({
    path: ".local/screenshots/template-preview-desktop.png",
    fullPage: true,
  });

  // 8. Keyboard & destructive confirm dialog safety focus + Force Remove gate
  await page
    .locator(".top-bar")
    .getByRole("link", { name: "VPS", exact: true })
    .click();
  await page.getByRole("tab", { name: "Active", exact: false }).click();
  await page.locator(".selector-card", { hasText: "Frankfurt-02" }).click();
  await page.getByRole("tab", { name: /Settings & Danger/i }).click();
  await page.getByRole("button", { name: "Delete VPS", exact: true }).click();
  await page.locator("dialog[open]").waitFor();
  const activeTagText = await page.evaluate(
    () => document.activeElement?.textContent?.trim() || "",
  );
  if (activeTagText !== "Cancel") {
    throw Error(`Expected initial focus on Cancel, got: ${activeTagText}`);
  }
  await page.keyboard.press("Escape");
  await page.locator("dialog[open]").waitFor({ state: "detached" });

  await page.getByRole("button", { name: "Force remove", exact: true }).click();
  await page.locator("dialog[open]").waitFor();
  await page.locator("dialog[open]").getByRole("button", { name: "Force remove", exact: true }).click();
  await page.locator("dialog[open] [role='alert']").waitFor();
  await page.keyboard.press("Escape");
  await page.locator("dialog[open]").waitFor({ state: "detached" });

  // 9. Reduced motion never leaves elements invisible
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .locator(".top-bar")
    .getByRole("link", { name: "Jetyet Overview" })
    .click();
  await sleep(120);
  const reducedOpacity = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const hero = document.querySelector(".hero-banner");
    const card = document.querySelector(".surface-card");
    return {
      h1: h1 ? getComputedStyle(h1).opacity : null,
      hero: hero ? getComputedStyle(hero).opacity : null,
      card: card ? getComputedStyle(card).opacity : null,
    };
  });
  if (
    reducedOpacity.h1 !== "1" ||
    reducedOpacity.hero !== "1" ||
    reducedOpacity.card !== "1"
  ) {
    throw Error(
      `Reduced motion left opacity != 1: ${JSON.stringify(reducedOpacity)}`,
    );
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
  await harness.close();
}
