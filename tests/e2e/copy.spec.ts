import { test, expect } from "@playwright/test";
import { mockInvestigation, runInvestigation } from "./appearance-fixture";

test("the local app has direct source links without public social metadata", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.locator("meta[property^=\"og:\"], meta[name^=\"twitter:\"], link[rel=canonical]")).toHaveCount(0);
  for (const selector of [".hero-input-area", ".site-footer"]) {
    const link = page.locator(selector).getByRole("link", { name: "GitHub source", exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "https://github.com/manishh-13/url-x-ray");
  }
});

test("local glossary keeps its GET explanation while distinguishing the browser edition", async ({ page }) => {
  await mockInvestigation(page);
  await page.goto("/");
  await runInvestigation(page);
  await page.getByLabel(/^Inspect HTTP:/).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator(".layer-glossary > summary").click();
  await expect(dialog.locator(".layer-glossary")).toContainText("The local app uses GET without browser cookies or sign-in credentials.");
  await expect(dialog).not.toContainText("LOCAL APP REQUIRED");
  await dialog.getByRole("button", { name: "URL", exact: true }).click();
  await dialog.locator(".layer-glossary > summary").click();
  await expect(dialog.locator(".layer-glossary")).toContainText("Only the local app requests the page.");
});
