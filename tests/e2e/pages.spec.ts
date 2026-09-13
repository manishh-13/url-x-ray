import { test, expect } from "@playwright/test";
import { mockBrowserLookups, runBrowserInvestigation } from "./pages-fixture";

async function downloadedBytes(download: import("@playwright/test").Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Download stream unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test("static edition queries real browser transports without an API or website request", async ({ page }) => {
  const calls = await mockBrowserLookups(page);
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await runBrowserInvestigation(page, "https://example.com/private-path?token=private-value#private-fragment");
  await expect(page.locator(".result-summary")).toContainText("Public DNS records, ready to explore.");
  await expect(page.locator(".result-eyebrow")).not.toContainText("PARTIAL");
  await expect(page.locator(".story-panel")).toContainText("AS13335");
  await expect(page.locator(".story-panel")).toContainText("network records");
  expect(calls.filter((call) => call.name === "example.com")).toHaveLength(9);
  expect(calls.every((call) => !call.referrer && !call.cookie)).toBe(true);
  expect(JSON.stringify(calls)).not.toMatch(/private-path|private-value|private-fragment/);
  expect(requests.some((url) => url.includes("/api/investigate"))).toBe(false);
  expect(requests.every((url) => ["127.0.0.1", "cloudflare-dns.com", "stat.ripe.net"].includes(new URL(url).hostname))).toBe(true);
  await page.getByLabel(/Inspect DNS:/).click();
  await expect(page.getByRole("dialog")).toContainText("alias.example.net");
  await page.getByRole("dialog").getByText("Inspect DNS records").click();
  await expect(page.getByRole("dialog").locator("table")).toContainText("1.1.1.1");
  expect(errors).toEqual([]);
});

test("Pages share links stay under the project subpath and require confirmation after reload", async ({ page }) => {
  const calls = await mockBrowserLookups(page);
  await page.goto("./");
  await runBrowserInvestigation(page, "https://example.com/a/path?token=secret#private");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const shared = await page.locator("#share-url").inputValue();
  expect(new URL(shared).pathname).toBe("/url-x-ray/");
  expect(new URL(shared).search).toBe("?host=example.com");
  expect(shared).not.toMatch(/a\/path|token|secret|private/);
  const count = calls.length;
  await page.goto(shared);
  await expect(page.getByRole("button", { name: "X-ray this hostname", exact: true })).toBeVisible();
  expect(calls).toHaveLength(count);
  await page.reload();
  await expect(page.getByRole("heading", { name: "example.com", exact: true })).toBeVisible();
  expect(calls).toHaveLength(count);
  await page.getByRole("button", { name: "X-ray this hostname", exact: true }).click();
  await expect(page.locator(".result-summary")).toContainText("Public DNS records, ready to explore.");
  expect(calls.length).toBeGreaterThan(count);
});

test("browser reports export actual lookups and local-only scope", async ({ page }) => {
  await mockBrowserLookups(page);
  await page.goto("./");
  await runBrowserInvestigation(page, "https://example.com/private-path?token=private-value#private-fragment");
  for (const format of ["JSON", "SVG", "PNG"] as const) {
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("dialog").getByRole("button", { name: new RegExp(`^${format} `) }).click();
    const bytes = await downloadedBytes(await downloaded);
    if (format === "JSON") {
      const report = JSON.parse(bytes.toString("utf8"));
      expect(report.investigation.edition).toBe("browser");
      expect(report.investigation.dns.addresses).toEqual(["1.1.1.1"]);
      expect(report.investigation.providers.http.reason).toBe("local-only");
      expect(report.investigation.http).toBeUndefined();
      expect(report.investigation.tls).toBeUndefined();
      expect(report.investigation.url.pathname).toBe("/private-path");
      expect(bytes.toString("utf8")).not.toMatch(/private-value|private-fragment/);
    } else if (format === "SVG") expect(bytes.toString("utf8")).toContain("Browser edition: public DNS and network lookups only.");
    else expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("NXDOMAIN is a DNS finding rather than an HTTP failure", async ({ page }) => {
  await mockBrowserLookups(page, "nxdomain");
  await page.goto("./");
  await runBrowserInvestigation(page);
  await expect(page.locator(".result-summary")).toContainText("This hostname did not resolve.");
  await expect(page.locator(".result-summary")).not.toContainText("request stopped");
  await expect(page.getByRole("button", { name: /Inspect HTTP: run locally/ })).toBeVisible();
});

test("a blocked resolver leaves a useful error and no hanging progress", async ({ page }) => {
  await mockBrowserLookups(page, "blocked");
  await page.goto("./");
  await runBrowserInvestigation(page);
  await expect(page.locator(".result-summary")).toContainText("The address lookup could not be completed.");
  await expect(page.locator(".progress-stage.investigating")).toHaveCount(0);
  await expect(page.locator(".result-summary")).not.toContainText("site is down");
});

test("an optional lookup failure keeps DNS results and a grounded next check", async ({ page }) => {
  await mockBrowserLookups(page, "partial");
  await page.goto("./");
  await runBrowserInvestigation(page);
  await expect(page.locator(".result-summary")).toContainText("HTTPS DNS query was unavailable");
  await expect(page.locator(".result-summary")).toContainText("Inspect the unavailable DNS queries");
  await expect(page.locator(".result-summary")).not.toContainText("request stopped");
});

test("the RIPEstat fallback remains available from the browser", async ({ page }) => {
  const calls = await mockBrowserLookups(page, "ripe-fallback");
  await page.goto("./");
  await runBrowserInvestigation(page);
  await expect(page.locator(".story-panel")).toContainText("AS13335");
  expect(calls.filter((call) => call.type === "RIPE")).toHaveLength(2);
  expect(calls.every((call) => !call.referrer && !call.cookie)).toBe(true);
});

test("private targets are rejected before a browser request", async ({ page }) => {
  const calls = await mockBrowserLookups(page);
  await page.goto("./");
  await page.getByLabel("Public URL to investigate").fill("http://169.254.169.254/latest/meta-data/");
  await page.getByRole("button", { name: "X-ray URL", exact: true }).click();
  await expect(page.locator(".form-error[role=alert]")).toContainText("not on the public Internet");
  expect(calls).toHaveLength(0);
});

test("Stop cancels pending lookups and a new run cannot receive their results", async ({ page }) => {
  let first: () => void = () => undefined;
  const received = new Promise<void>((resolve) => { first = resolve; });
  const held: import("@playwright/test").Route[] = [];
  await page.route("https://cloudflare-dns.com/dns-query?*", (route) => { held.push(route); first(); });
  await page.goto("./");
  await page.getByLabel("Public URL to investigate").fill("first.example.com");
  await page.getByRole("button", { name: "X-ray URL", exact: true }).click();
  await received;
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".result-summary")).toContainText("This investigation stopped early.");
  await page.unroute("https://cloudflare-dns.com/dns-query?*");
  await Promise.all(held.map((route) => route.abort().catch(() => undefined)));
  await mockBrowserLookups(page);
  await page.getByRole("button", { name: "New investigation", exact: true }).click();
  await runBrowserInvestigation(page, "second.example.com");
  await expect(page.locator(".result-title-row h1")).toContainText("second.example.com");
  await expect(page.locator(".result-summary")).toContainText("Public DNS records, ready to explore.");
  await expect(page.locator(".result-title-row")).not.toContainText("first.example.com");
});


test("a public IPv6 share starts with the correct bracketed URL", async ({ page }) => {
  const calls = await mockBrowserLookups(page);
  await page.goto("./?host=2606%3A4700%3A4700%3A%3A1111");
  await expect(page.getByRole("heading", { name: "2606:4700:4700::1111", exact: true })).toBeVisible();
  expect(calls).toHaveLength(0);
  await page.getByRole("button", { name: "X-ray this hostname", exact: true }).click();
  await expect(page.locator(".result-summary")).toContainText("Public address, ready to explore.");
  expect(calls.some((call) => call.type === "A" || call.type === "AAAA")).toBe(false);
  await expect(page.getByLabel("Inspect DNS: not needed", { exact: true })).toBeVisible();
});

test("an off-public DNS answer is visible without requesting or enriching that address", async ({ page }) => {
  const calls = await mockBrowserLookups(page, "private-address");
  await page.goto("./");
  await runBrowserInvestigation(page);
  await expect(page.locator(".result-summary")).toContainText("DNS returned a non-public address.");
  expect(calls).toHaveLength(9);
  expect(calls.some((call) => call.name.includes("origin.asn") || call.type === "RIPE")).toBe(false);
});

test("dark mode retains browser findings and the same local-only boundaries", async ({ page }) => {
  const calls = await mockBrowserLookups(page);
  await page.goto("./");
  await runBrowserInvestigation(page);
  const before = calls.length;
  await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".result-summary")).toContainText("Public DNS records, ready to explore.");
  await page.getByRole("button", { name: "Run locally", exact: true }).first().click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Download project ZIP" })).toBeVisible();
  expect(calls).toHaveLength(before);
});
