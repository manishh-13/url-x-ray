import { test, expect } from "@playwright/test";

/**
 * The hosted static shell, served the way a static host serves it.
 *
 * These tests assume `npm run build:pages` has already produced pages-app/out;
 * they never build. Scope is deliberately the shell itself: the export is static
 * with no investigation endpoint, every asset it asks for stays under the base
 * path, and the page states which edition it is. The live DNS and network
 * pipeline, sharing, exports and cancellation are covered by pages.spec.ts.
 */
test("the exported shell serves the app under its base path and names its edition", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const prefix = new URL(baseURL!).pathname;
  const offBasePath: string[] = [];
  const outbound: string[] = [];

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === origin) {
      if (!url.pathname.startsWith(prefix)) offBasePath.push(url.pathname);
      return;
    }
    outbound.push(url.href);
  });

  await page.goto("./");

  await expect(page.getByRole("heading", { name: "See what’s behind a URL." })).toBeVisible();
  await expect(page.locator(".edition-badge")).toHaveText("BROWSER EDITION");
  await expect(page.getByRole("heading", { name: "In the local app" })).toBeVisible();
  await expect(page.locator("#input-privacy")).toContainText("DNS and network run live in this browser.");

  // A wrong asset prefix is the classic base path failure, and it only shows up
  // when the site is served from a subpath, which is what this suite does.
  expect(offBasePath).toEqual([]);
  // Loading the page is not an investigation: nothing is looked up until asked.
  expect(outbound).toEqual([]);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", new RegExp(`^${prefix}`));
});

test("the export contains a static site only, with no investigation endpoint", async ({ request, baseURL }) => {
  const endpoint = new URL("api/investigate", baseURL).href;
  // A static host answers a write with 405 and an unknown read with 404. Either
  // one proves the same thing: there is no investigation endpoint in the export.
  const posted = await request.post(endpoint, { data: { url: "https://example.com" }, failOnStatusCode: false });
  expect([404, 405]).toContain(posted.status());
  expect((await request.get(endpoint, { failOnStatusCode: false })).status()).toBe(404);

  // The dynamic hostname route belongs to the local app, so it is absent here
  // and shared links use the ?host= form instead.
  expect((await request.get(new URL("xray/example.com/", baseURL).href, { failOnStatusCode: false })).status()).toBe(404);
});

test("an unknown path inside the site returns the app's own not found page", async ({ page, baseURL }) => {
  const response = await page.goto(new URL("no-such-page/", baseURL).href);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Nothing to observe here." })).toBeVisible();
});
