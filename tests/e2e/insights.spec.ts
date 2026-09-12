import { test, expect, type Page } from "@playwright/test";
import type { Investigation } from "../../src/lib/types";
import { appearanceInvestigation, mockInvestigation, runInvestigation, settledDialog, themeToggle } from "./appearance-fixture";

function healthy(): Investigation {
  const i = appearanceInvestigation();
  i.dns!.queryStatus.CAA = "NOERROR, no records";
  i.dns!.queryStatus.SVCB = "NOERROR, no records";
  return i;
}

async function inspect(page: Page, i: Investigation) {
  const calls = await mockInvestigation(page, i);
  await page.goto("/");
  await runInvestigation(page);
  await expect(page.locator(".result-summary")).toBeVisible();
  return calls;
}

function removeResponse(i: Investigation) {
  i.http = { hops: [], finalUrl: i.url.href, finalStatus: 0, redirectCount: 0, chainComplete: false, headerSignals: [], durationMs: 20, stoppedReason: "No response was received." };
  i.providers.http = { status: "unavailable", message: "No response was received." };
}

test("a short takeaway and five findings lead to the full evidence without rerunning", async ({ page }) => {
  const calls = await inspect(page, healthy());
  const summary = page.locator(".result-summary");
  const story = page.getByRole("complementary", { name: "The story behind this URL" });
  await expect(summary.getByRole("heading", { name: "This request succeeded." })).toBeVisible();
  await expect(summary).toContainText("HTTP 200 after 1 redirect");
  await expect(summary.locator(".next-check")).toHaveCount(0);
  await expect(story.locator(".story-finding")).toHaveCount(5);
  await expect(story).toContainText("2 addresses in one network");
  const expand = story.getByRole("button", { name: /Show all findings/ });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expand.click();
  await expect(story.getByRole("heading", { name: "Authoritative nameservers" })).toBeVisible();
  await expect(story.getByText("Some DNS queries did not complete", { exact: true })).toHaveCount(0);
  expect(await story.locator(".story-finding").count()).toBeGreaterThan(5);
  await story.getByRole("button", { name: "Show fewer findings" }).click();
  await expect(story.locator(".story-finding")).toHaveCount(5);
  await themeToggle(page, "dark").click();
  await expect(summary.getByRole("heading", { name: "This request succeeded." })).toBeVisible();
  await expect(story.locator(".story-finding")).toHaveCount(5);
  expect(calls.count).toBe(1);
});

test("a refused request offers a next check and opens the response evidence", async ({ page }) => {
  const i = healthy();
  i.http!.finalStatus = 403;
  i.http!.hops[i.http!.hops.length - 1].status = 403;
  i.evidence.find((item) => item.id === "http-status")!.value = "403";
  await inspect(page, i);
  const summary = page.locator(".result-summary");
  await expect(summary.getByRole("heading", { name: "This request was refused (HTTP 403)." })).toBeVisible();
  await expect(summary.getByRole("heading", { name: "Check the access requirements" })).toBeVisible();
  await expect(summary).not.toContainText("Cloudflare blocked");
  const opener = summary.getByRole("button", { name: "Open Redirects & HTTP", exact: true });
  await opener.click();
  const dialog = await settledDialog(page);
  await expect(dialog).toHaveAccessibleName("The response");
  await expect(dialog.locator(".http-status").last()).toHaveText("403");
  await dialog.getByRole("button", { name: "Close panel" }).click();
  await expect(opener).toBeFocused();
});

test("an expired certificate puts its date and renewal check before the graph", async ({ page }) => {
  const i = healthy();
  removeResponse(i);
  i.tls!.authorized = false;
  i.tls!.authorizationError = "CERT_HAS_EXPIRED";
  i.tls!.validTo = "Sep 1 00:00:00 2026 GMT";
  await inspect(page, i);
  const summary = page.locator(".result-summary");
  await expect(summary.getByRole("heading", { name: "The certificate had expired." })).toBeVisible();
  await expect(summary).toContainText("1 Sept 2026 UTC");
  await expect(summary.getByRole("heading", { name: "Check certificate renewal" })).toBeVisible();
  await summary.getByRole("button", { name: "Open Certificate", exact: true }).click();
  await expect((await settledDialog(page))).toHaveAccessibleName("TLS certificate");
  await expect(page.locator("dialog[open]")).toContainText("CERT_HAS_EXPIRED");
});

for (const scenario of [
  { status: "NXDOMAIN", heading: "This hostname did not resolve.", next: "Check the hostname and its DNS records" },
  { status: "SERVFAIL", heading: "The address lookup could not be completed.", next: "Check the resolver response" },
]) {
  test(`${scenario.status} is explained accurately with a DNS next check`, async ({ page }) => {
    const i = healthy(); removeResponse(i);
    i.dns!.addresses = [];
    i.dns!.records = [];
    i.dns!.queryStatus = { A: scenario.status, AAAA: scenario.status };
    delete i.tls; delete i.network; delete i.technology;
    i.providers.tls.status = "unavailable";
    i.providers.network.status = "unavailable";
    i.providers.technology.status = "unavailable";
    await inspect(page, i);
    const summary = page.locator(".result-summary");
    await expect(summary.getByRole("heading", { name: scenario.heading })).toBeVisible();
    await expect(summary.getByRole("heading", { name: scenario.next })).toBeVisible();
    await summary.getByRole("button", { name: "Open DNS", exact: true }).click();
    const dialog = await settledDialog(page);
    await expect(dialog).toHaveAccessibleName("DNS resolution");
    await dialog.getByText("Query availability", { exact: true }).click();
    await expect(dialog.locator(".definition-list")).toContainText(scenario.status);
  });
}

test("plain-language definitions are optional and network groups keep individual addresses", async ({ page }) => {
  await inspect(page, healthy());
  await page.getByLabel(/Inspect DNS/i).click();
  let dialog = await settledDialog(page);
  const glossary = dialog.locator(".layer-glossary");
  await expect(glossary).not.toHaveAttribute("open", "");
  const termButton = glossary.locator("summary");
  await termButton.focus();
  await termButton.press("Enter");
  await expect(glossary.locator("dd").filter({ hasText: "Time to live:" })).toBeVisible();
  await termButton.press("Enter");
  await expect(glossary.locator("dd").first()).toBeHidden();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "IP & network", exact: true }).click();
  dialog = await settledDialog(page);
  await expect(dialog.locator(".network-group")).toHaveCount(1);
  await expect(dialog.locator(".network-group-heading")).toContainText("AS15133");
  await expect(dialog.locator(".network-address")).toHaveCount(2);
  await dialog.locator(".network-address > summary").first().click();
  await expect(dialog.locator(".network-address").first()).toContainText("93.184.216.0/24");
});

test("query removal remains visible and cannot be mistaken for the exact original request", async ({ page }) => {
  const i = healthy(); i.url.hasQuery = true; i.url.queryKeys = ["token"];
  await inspect(page, i);
  await expect(page.locator(".result-summary-note")).toContainText("Query parameters were removed");
  await expect(page.locator(".result-summary-note")).toContainText("different result");
});

test("an interrupted stream retains evidence without a successful-run claim", async ({ page }) => {
  const i = healthy(); delete i.finishedAt; delete i.tls;
  i.providers.tls.status = "investigating";
  await page.route("**/api/investigate", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "start", investigation: i })}\n` });
  });
  await page.goto("/");
  await runInvestigation(page);
  await expect(page.locator(".result-summary h2")).toHaveText("This investigation stopped early.");
  await expect(page.locator(".result-notice")).toBeVisible();
  await expect(page.getByLabel(/Inspect DNS/i)).toBeVisible();
  await expect(page.locator(".result-summary")).not.toContainText("This request succeeded");
});

test.describe("readable motion and graph labels", () => {
  test.use({ reducedMotion: "reduce" });

  test("reduced motion hydrates cleanly and follows a live preference change", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Switch to dark mode" })).toBeVisible();
    await expect(page.locator(".concept-svg animateMotion")).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(page.locator(".concept-svg animateMotion")).toHaveCount(4);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".concept-svg animateMotion")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("graph labels fit their boxes at narrow laptop and phone widths", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Widths are covered once in the desktop engine");
    await inspect(page, healthy());
    for (const width of [1440, 1200, 1024, 820, 700, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
      const problems = await page.locator(".graph-node").evaluateAll((nodes) => nodes.flatMap((node) => {
        const rect = node.getBoundingClientRect();
        const detail = node.querySelector(".node-detail") as HTMLElement;
        const title = node.querySelector("strong") as HTMLElement;
        const label = node.querySelector(".node-top") as HTMLElement;
        const r = detail.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(detail).lineHeight);
        const clipped = detail.clientHeight < lineHeight - 1 || r.bottom > rect.bottom - 2 || title.getBoundingClientRect().top < label.getBoundingClientRect().bottom - 1;
        return clipped ? [`${node.getAttribute("aria-label")}: label line ${detail.clientHeight}px/${lineHeight}px, bottom ${r.bottom - rect.bottom}px`] : [];
      }));
      expect(problems, `graph labels clipped at ${width}px`).toEqual([]);
    }
  });
});
