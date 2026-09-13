import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: node tests/e2e/record-gif.mjs <empty-frame-directory>");
const frames = resolve(directory);
if (existsSync(frames)) throw new Error("Choose a new frame directory so an earlier recording cannot be overwritten.");
await mkdir(frames, { recursive: true });

const source = process.env.README_DEMO_URL ?? "https://manishh-13.github.io/url-x-ray/";
const localChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync(localChrome) ? localChrome : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, colorScheme: "light" });
page.setDefaultTimeout(25_000);
const errors = [];
const requests = [];
const timeline = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => requests.push(request.url()));

async function shot(label, duration) {
  const file = `${String(timeline.length).padStart(3, "0")}.png`;
  await page.screenshot({ path: join(frames, file), caret: "hide" });
  timeline.push({ file, label, duration });
}

async function settle() {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity);
    await Promise.all(finite.map(animation => animation.finished.catch(() => undefined)));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function scrollToWorkspace() {
  const start = await page.evaluate(() => window.scrollY);
  const end = await page.locator("#investigation-workspace").evaluate(element => window.scrollY + element.getBoundingClientRect().top - 12);
  for (let frame = 1; frame <= 12; frame++) {
    const progress = frame / 12;
    const eased = 1 - Math.pow(1 - progress, 3);
    await page.evaluate(y => window.scrollTo({ top: y, behavior: "instant" }), start + (end - start) * eased);
    await shot("scroll-to-map", 50);
  }
}

try {
  await page.goto(source, { waitUntil: "networkidle" });
  await page.getByLabel("Public URL to investigate").waitFor();
  await settle();
  if (await page.locator("html").getAttribute("data-theme") !== "light") throw new Error("The demo must show the default light theme.");
  if (await page.locator(".edition-badge").innerText() !== "BROWSER EDITION") throw new Error("Record the browser edition, not the local backend.");
  await shot("landing", 2000);

  const input = page.getByLabel("Public URL to investigate");
  for (const value of ["https://", "https://example", "https://example.com"]) {
    await input.fill(value);
    await shot("enter-url", 180);
  }
  await shot("url-ready", 700);
  await page.getByRole("button", { name: "X-ray URL", exact: true }).click();
  await page.locator(".result-title-row").waitFor();
  await page.waitForFunction(() => document.querySelector(".result-eyebrow")?.textContent.includes("X-RAY COMPLETE"), null, { timeout: 45_000 });
  await settle();
  const summary = await page.locator(".result-summary").innerText();
  if (!summary.includes("Public DNS records, ready to explore.")) throw new Error(`The live lookup did not finish successfully: ${summary}`);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await shot("live-result", 2600);

  await scrollToWorkspace();
  await shot("infrastructure-map", 3200);
  await page.getByLabel(/^Inspect DNS:/).click();
  const dns = page.getByRole("dialog", { name: "DNS resolution", exact: true });
  await dns.waitFor();
  await dns.getByText("Inspect DNS records").click();
  await settle();
  await shot("live-dns-records", 3000);
  await page.keyboard.press("Escape");

  await page.getByRole("group", { name: "X-ray depth" }).getByRole("button", { name: /Evidence/ }).click();
  await page.getByRole("heading", { name: "Show your work.", exact: true }).waitFor();
  await page.getByLabel("Filter evidence").fill("asn");
  await settle();
  await shot("network-evidence", 3000);

  await page.getByRole("group", { name: "X-ray depth" }).getByRole("button", { name: /Overview/ }).click();
  await settle();
  await shot("map-finish", 2200);
  const lookupRequests = requests.filter(value => ["cloudflare-dns.com", "stat.ripe.net"].includes(new URL(value).hostname));
  if (!lookupRequests.length) throw new Error("No live lookup requests were recorded.");
  const unexpected = requests.filter(value => ![new URL(source).origin, "https://cloudflare-dns.com", "https://stat.ripe.net"].includes(new URL(value).origin));
  if (unexpected.length || requests.some(value => value.includes("/api/investigate"))) throw new Error(`Unexpected target or backend request: ${unexpected.join(", ")}`);
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  await writeFile(join(frames, "timeline.json"), JSON.stringify({ source, recordedAt: new Date().toISOString(), width: 1280, height: 900, theme: "light", edition: "browser", summary, lookupRequests, errors, frames: timeline }, null, 2) + "\n");
  console.log(`Captured ${timeline.length} frames from the live browser edition: ${frames}`);
} finally {
  await browser.close();
}
