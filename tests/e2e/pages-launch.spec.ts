import { test, expect } from "@playwright/test";
import { mockBrowserLookups, runBrowserInvestigation } from "./pages-fixture";
import { siteOriginFromEnv } from "../../scripts/site-origin.mjs";

test("public share metadata and the PNG work under the deployed base path", async ({ page, request, baseURL }) => {
  const prefix = new URL(baseURL!).pathname;
  const canonical = new URL(prefix, siteOriginFromEnv()).href;
  const image = new URL("social-preview.png", canonical).href;
  await page.goto("./?host=example.com");
  await expect(page.locator("link[rel=canonical]")).toHaveAttribute("href", canonical);
  await expect(page.locator("meta[property=\"og:url\"]")).toHaveAttribute("content", canonical);
  await expect(page.locator("meta[property=\"og:image\"]")).toHaveAttribute("content", image);
  await expect(page.locator("meta[property=\"og:image:width\"]")).toHaveAttribute("content", "1200");
  await expect(page.locator("meta[property=\"og:image:height\"]")).toHaveAttribute("content", "630");
  await expect(page.locator("meta[name=\"twitter:card\"]")).toHaveAttribute("content", "summary_large_image");
  await expect(page.locator("meta[name=\"twitter:image\"]")).toHaveAttribute("content", image);
  await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", "index, follow");
  const response = await request.get(new URL("social-preview.png", baseURL!).href);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/png");
  const png = await response.body();
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
});

test("GitHub source is directly accessible on the landing page and footer", async ({ page }) => {
  await page.goto("./");
  for (const selector of [".hero-input-area", ".site-footer"]) {
    const link = page.locator(selector).getByRole("link", { name: "GitHub source", exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "https://github.com/manishh-13/url-x-ray");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toHaveAttribute("target", "_blank");
  }
  for (const width of [320, 390, 760, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.locator(".site-footer").evaluate(element => element.scrollWidth - element.clientWidth);
    expect(overflow, `footer overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
});

test("the shared glossary describes target requests as local-only", async ({ page }) => {
  const calls = await mockBrowserLookups(page);
  await page.goto("./");
  await runBrowserInvestigation(page);
  const count = calls.length;
  await page.getByLabel(/^Inspect HTTP:/).click();
  let dialog = page.getByRole("dialog");
  await dialog.locator(".layer-glossary > summary").click();
  await expect(dialog.locator(".layer-glossary")).toContainText("The local app uses GET");
  await expect(dialog.locator(".layer-glossary")).toContainText("The browser edition does not request the inspected website.");
  await expect(dialog.locator(".layer-glossary")).not.toContainText("This observation sends a GET");
  await dialog.getByRole("button", { name: "URL", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.locator(".layer-glossary > summary").click();
  await expect(dialog.locator(".layer-glossary")).toContainText("Only the local app requests the page.");
  expect(calls).toHaveLength(count);
});
