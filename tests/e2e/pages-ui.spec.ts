import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockBrowserLookups, runBrowserInvestigation } from "./pages-fixture";
import { settledDialog } from "./appearance-fixture";

/* Browser-edition interface tests: the edition badge, the run-locally action, and
   the intentional local-app panels. The static build is served under a base path,
   so navigation is relative to baseURL. Under the local dev config these skip. */
test.beforeEach(async ({ baseURL }) => {
  test.skip(!baseURL?.includes("/url-x-ray/"), "Browser edition build only");
});

test("the header and landing state which layers are live and which need the local app", async ({ page }) => {
  await page.goto("./");
  /* The badge is intentionally hidden on narrow viewports, so assert the text in
     the DOM rather than its visibility, and scope capability names to their own
     section: "TLS certificate" also appears in the conceptual schematic. */
  await expect(page.locator(".edition-badge")).toHaveText(/BROWSER EDITION/);
  await expect(page.getByText("PRIVATE ALPHA")).toHaveCount(0);
  const capabilities = page.locator(".edition-capabilities");
  await expect(capabilities.getByRole("heading", { name: /Live here/ })).toBeVisible();
  await expect(capabilities.getByRole("heading", { name: "Live in this browser" })).toBeVisible();
  await expect(capabilities.getByText("DNS records")).toBeVisible();
  await expect(capabilities.getByText("IP and network")).toBeVisible();
  await expect(capabilities.getByText("Reverse DNS")).toBeVisible();
  await expect(capabilities.getByRole("heading", { name: "In the local app" })).toBeVisible();
  await expect(capabilities.getByText("TLS certificate")).toBeVisible();
  await expect(capabilities.getByText("Redirects and headers")).toBeVisible();
  await expect(capabilities.getByText("Response technologies", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /try (the )?(live|hosted|public) site/i })).toHaveCount(0);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("run locally opens an accessible dialog with the download, source and commands", async ({ page }) => {
  await page.goto("./");
  const trigger = page.getByRole("button", { name: "Run locally" }).first();
  await trigger.click();
  const dialog = await settledDialog(page);
  await expect(dialog.getByRole("heading", { name: "Run every check on your machine." })).toBeVisible();
  await expect(dialog.getByRole("link", { name: /Download project ZIP/ })).toHaveAttribute("href", "https://github.com/manishh-13/url-x-ray/archive/refs/heads/main.zip");
  await expect(dialog.getByRole("link", { name: /GitHub source/ })).toHaveAttribute("href", "https://github.com/manishh-13/url-x-ray");
  await expect(dialog.getByText("Install Node.js 22 or newer")).toBeVisible();
  await expect(dialog.getByText(/Extract the ZIP and open a terminal/)).toBeVisible();
  await expect(dialog.getByText("npm ci")).toBeVisible();
  await expect(dialog.getByText("npm run dev")).toBeVisible();
  await expect(dialog.getByText("http://127.0.0.1:3099")).toBeVisible();
  await expect(dialog.getByText(/No API keys, no account, no card/)).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("a shared host link looks nothing up until the reader confirms", async ({ page }) => {
  const calls = await mockBrowserLookups(page);
  await page.goto("./?host=example.com");
  await expect(page.getByRole("heading", { name: "example.com" })).toBeVisible();
  await expect(page.getByText(/Nothing has been looked up yet/)).toBeVisible();
  expect(calls).toEqual([]);
  await page.getByRole("button", { name: /X-ray this hostname/ }).click();
  await expect(page.locator(".result-title-row h1")).toContainText("example.com");
  await expect.poll(() => calls.length).toBeGreaterThan(0);
});

test("layers a browser cannot observe read as local app, not as failure", async ({ page }) => {
  await mockBrowserLookups(page);
  await page.goto("./");
  await runBrowserInvestigation(page);
  await expect(page.getByText("HTTP: local app")).toBeVisible();
  await expect(page.getByText("TLS: local app")).toBeVisible();
  await expect(page.getByText("Technologies: local app")).toBeVisible();
  await expect(page.getByText("TLS unavailable")).toHaveCount(0);
  await expect(page.getByText("HTTP unavailable")).toHaveCount(0);
  await expect(page.getByText(/DNS and network are live here/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Run locally" }).last()).toBeVisible();
});

test("a local-only layer explains the limit and offers setup in the same dialog", async ({ page }) => {
  await mockBrowserLookups(page);
  await page.goto("./");
  await runBrowserInvestigation(page);
  await page.getByRole("button", { name: "Certificate", exact: true }).first().click();
  const dialog = await settledDialog(page);
  await expect(dialog.getByText("LOCAL APP REQUIRED")).toBeVisible();
  await expect(dialog.getByRole("heading", { name: /Certificate inspection needs the local app/ })).toBeVisible();
  await expect(dialog.getByText(/Browsers do not expose another website's TLS certificate/)).toBeVisible();
  await dialog.locator("summary", { hasText: "How to run it locally" }).click();
  await expect(dialog.getByRole("link", { name: /Download project ZIP/ })).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("redirects and technologies layers keep the same intentional panel", async ({ page }) => {
  await mockBrowserLookups(page);
  await page.goto("./");
  await runBrowserInvestigation(page);
  await page.getByRole("button", { name: "Redirects & HTTP", exact: true }).first().click();
  const dialog = await settledDialog(page);
  await expect(dialog.getByRole("heading", { name: /Redirects and headers need the local app/ })).toBeVisible();
  await dialog.getByRole("button", { name: "Tech" }).click();
  await expect(dialog.getByRole("heading", { name: /Response technologies need the local app/ })).toBeVisible();
  await expect(dialog.getByText(/does not fetch the website's response/)).toBeVisible();
});
