import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  BODY_MIN_PX, BODY_SELECTORS, DATA_MIN_PX, DATA_SELECTORS, META_MIN_PX, META_SELECTORS,
  dialogBox, documentOverflow, formatViolations, matchedSelectors, mockInvestigation,
  openDisclosures, runInvestigation, settledDialog, textSizes, theme, themeToggle, tooSmall,
} from "./appearance-fixture";

const CENTER_TOLERANCE = 3;

type DialogCase = { title: string; needsResult: boolean; open: (page: Page) => Promise<void> };

const dialogCases: DialogCase[] = [
  { title: "Understand the invisible.", needsResult: false, open: (page) => page.getByRole("button", { name: /How it works/ }).click() },
  // Opened from the footer, which sits below the fold: a modal must still centre
  // against the viewport, not against the scrolled opener.
  { title: "Curiosity has boundaries.", needsResult: false, open: (page) => page.getByRole("button", { name: /Privacy & scope/ }).click() },
  { title: "DNS resolution", needsResult: true, open: (page) => page.getByLabel(/Inspect DNS/i).click() },
  { title: "TLS certificate", needsResult: true, open: (page) => page.getByLabel(/Inspect TLS/i).click() },
  { title: "Keep the observation.", needsResult: true, open: (page) => page.getByRole("button", { name: "Export" }).click() },
  { title: "Share the starting point.", needsResult: true, open: (page) => page.getByRole("button", { name: "Share" }).click() },
];

// Every layer of the detail drawer, addressed through the switcher inside it.
const layerTabs = [
  { tab: "URL", title: "The URL" },
  { tab: "DNS", title: "DNS resolution" },
  { tab: "HTTP", title: "The response" },
  { tab: "TLS", title: "TLS certificate" },
  { tab: "NETWORK", title: "IP & network" },
  { tab: "Edge", title: "Edge & hosting" },
  { tab: "Tech", title: "Technologies" },
];

async function openCase(page: Page, dialogCase: DialogCase) {
  await dialogCase.open(page);
  const dialog = await settledDialog(page);
  // dialog[open] is unique here, so naming the role confirms the open dialog is
  // the intended one without depending on how the name is wired up.
  await expect(page.getByRole("dialog", { name: dialogCase.title })).toBeVisible();
  return dialog;
}

async function closeActive(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}

/** Switches the open detail drawer to one layer and waits for its entrance. */
async function selectLayer(page: Page, dialog: Locator, tab: string, title: string) {
  await dialog.getByRole("button", { name: tab, exact: true }).click();
  await expect(page.getByRole("dialog", { name: title })).toBeVisible();
  await settledDialog(page);
}

/** The overview keeps the full story behind a button; open it when it is there. */
async function revealFullStory(page: Page) {
  const showAll = page.getByRole("button", { name: /Show all findings/i });
  if (await showAll.count() === 0) return;
  await showAll.first().click();
  await expect(page.locator(".story-finding").first()).toBeVisible();
}

test.describe("theme", () => {
  test.use({ colorScheme: "dark" });

  test("light is the default under an OS dark preference, dark is an explicit unsaved choice", async ({ page }) => {
    await page.goto("/");
    expect(await theme(page)).toBe("light");

    const toDark = themeToggle(page, "dark");
    await expect(toDark).toBeVisible();
    await toDark.click();
    await expect.poll(() => theme(page)).toBe("dark");

    const toLight = themeToggle(page, "light");
    await expect(toLight).toBeVisible();
    await expect(themeToggle(page, "dark")).toHaveCount(0);
    await toLight.click();
    await expect.poll(() => theme(page)).toBe("light");

    // Dark is a session-only choice: a reload starts from light again, and
    // nothing about the theme is written to web storage.
    await themeToggle(page, "dark").click();
    await expect.poll(() => theme(page)).toBe("dark");
    await page.reload();
    expect(await theme(page)).toBe("light");
    await expect(themeToggle(page, "dark")).toBeVisible();
    const persisted = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
    expect(persisted.filter((key) => /theme|color|dark|light/i.test(key))).toEqual([]);
  });
});

test("switching theme keeps a completed investigation intact", async ({ page }) => {
  const calls = await mockInvestigation(page);
  await page.goto("/");
  await runInvestigation(page);
  await expect(page.getByText("X-RAY COMPLETE")).toBeVisible();
  const before = await page.locator(".result-title-row h1").innerText();

  await themeToggle(page, "dark").click();
  await expect.poll(() => theme(page)).toBe("dark");
  await expect(page.locator(".result-title-row h1")).toHaveText(before);
  await expect(page.getByText("X-RAY COMPLETE")).toBeVisible();

  await themeToggle(page, "light").click();
  await expect.poll(() => theme(page)).toBe("light");
  await expect(page.locator(".result-title-row h1")).toHaveText(before);
  await expect(page.getByLabel(/Inspect DNS/i)).toBeVisible();
  expect(calls.count).toBe(1);
});

test("desktop dialogs centre in the viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop project only");
  const calls = await mockInvestigation(page);
  await page.goto("/");

  const offsets: string[] = [];
  for (const dialogCase of dialogCases) {
    if (dialogCase.needsResult && calls.count === 0) await runInvestigation(page);
    const dialog = await openCase(page, dialogCase);
    const box = await dialogBox(dialog);
    expect(box.viewportWidth).toBeGreaterThanOrEqual(621);
    const horizontal = Math.abs(box.left - (box.viewportWidth - box.right));
    const vertical = Math.abs(box.top - (box.viewportHeight - box.bottom));
    if (horizontal > CENTER_TOLERANCE || vertical > CENTER_TOLERANCE) {
      offsets.push(`${dialogCase.title}: off-centre by ${horizontal.toFixed(1)}px across, ${vertical.toFixed(1)}px down`);
    }
    expect(box.width).toBeLessThanOrEqual(box.viewportWidth);
    expect(box.height).toBeLessThanOrEqual(box.viewportHeight);
    await closeActive(page);
  }
  expect(offsets).toEqual([]);
});

test("mobile dialogs sit on the bottom edge and stay scrollable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile project only");
  const calls = await mockInvestigation(page);
  await page.goto("/");

  const problems: string[] = [];
  for (const dialogCase of dialogCases) {
    if (dialogCase.needsResult && calls.count === 0) await runInvestigation(page);
    const dialog = await openCase(page, dialogCase);
    const box = await dialogBox(dialog);
    if (Math.abs(box.viewportHeight - box.bottom) > CENTER_TOLERANCE) {
      problems.push(`${dialogCase.title}: bottom edge is ${(box.viewportHeight - box.bottom).toFixed(1)}px off the viewport floor`);
    }
    if (box.left < -1 || box.right > box.viewportWidth + 1) {
      problems.push(`${dialogCase.title}: overflows horizontally (${box.left.toFixed(1)} to ${box.right.toFixed(1)} in ${box.viewportWidth})`);
    }
    const body = await dialog.evaluate((el) => {
      const scroller = Array.from(el.querySelectorAll("*")).find((node) => {
        const overflowY = getComputedStyle(node).overflowY;
        return overflowY === "auto" || overflowY === "scroll";
      }) as HTMLElement | undefined;
      if (!scroller) return null;
      const before = scroller.scrollTop;
      scroller.scrollTop = 120;
      const moved = scroller.scrollTop;
      scroller.scrollTop = before;
      return { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, moved };
    });
    if (!body) problems.push(`${dialogCase.title}: no scrollable region inside the dialog`);
    else if (body.scrollHeight > body.clientHeight && body.moved <= 0) problems.push(`${dialogCase.title}: overflowing body did not scroll`);
    await expect(dialog.getByRole("button", { name: "Close panel" })).toBeInViewport();
    await closeActive(page);
  }
  const overflow = await documentOverflow(page);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  expect(problems).toEqual([]);
});

test("Escape closes the dialog and restores the opener and the page scroll", async ({ page }) => {
  await page.goto("/");
  const opener = page.getByRole("button", { name: /Privacy & scope/ });
  await opener.scrollIntoViewIfNeeded();
  await opener.focus();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const bodyOverflow = () => page.evaluate(() => getComputedStyle(document.body).overflow);
  const overflowBefore = await bodyOverflow();

  await opener.press("Enter");
  await settledDialog(page);
  await expect(page.getByRole("dialog", { name: "Curiosity has boundaries." })).toBeVisible();
  expect(await bodyOverflow(), "the page behind the dialog should not scroll").not.toBe(overflowBefore);

  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect.poll(bodyOverflow).toBe(overflowBefore);
  expect(Math.abs(await page.evaluate(() => window.scrollY) - scrollBefore)).toBeLessThanOrEqual(CENTER_TOLERANCE);
});

// Runs in both projects, so the mobile viewport is held to the same floors as
// the desktop one: a responsive rule may not shrink type below them.
test("text stays legible and nothing overflows sideways", async ({ page }) => {
  await mockInvestigation(page);
  await page.goto("/");

  const small: string[] = [];
  const matched = new Set<string>();
  const collect = async (state: "landing" | "result" | "dialog") => {
    const body = BODY_SELECTORS[state], meta = META_SELECTORS[state];
    const data = state === "landing" ? [] : DATA_SELECTORS[state];
    small.push(...tooSmall(await textSizes(page, body), BODY_MIN_PX));
    small.push(...tooSmall(await textSizes(page, meta), META_MIN_PX));
    if (data.length) small.push(...tooSmall(await textSizes(page, data), DATA_MIN_PX));
    for (const selector of await matchedSelectors(page, [...body, ...meta, ...data])) matched.add(selector);
  };
  const noSideScroll = async (where: string) => {
    const overflow = await documentOverflow(page);
    expect(overflow.scrollWidth, `${where} scrolls sideways`).toBeLessThanOrEqual(overflow.clientWidth + 1);
  };

  await collect("landing");
  await noSideScroll("landing");

  await runInvestigation(page);
  await revealFullStory(page);
  await collect("result");
  await noSideScroll("result");

  // Every layer, with its disclosures expanded, so the tables, header lists and
  // provenance rows are measured rather than skipped as hidden.
  const dialog = await openCase(page, dialogCases[2]);
  for (const { tab, title } of layerTabs) {
    await selectLayer(page, dialog, tab, title);
    await openDisclosures(dialog);
    await collect("dialog");
  }
  await closeActive(page);

  for (const dialogCase of [dialogCases[0], dialogCases[1], dialogCases[4], dialogCases[5]]) {
    await openCase(page, dialogCase);
    await collect("dialog");
    await closeActive(page);
  }

  expect(small).toEqual([]);
  // A pass has to come from measurements that happened: these are the selectors
  // whose absence would make the whole check vacuous.
  for (const selector of [".detail-intro", "table td", "th", ".definition-list dt", ".raw-details > summary", ".progress-stage", ".graph-legend span", ".evidence-provenance"]) {
    expect([...matched], `${selector} never matched, so its floor was never checked`).toContain(selector);
  }
});

test("narrow laptop widths keep the layout and the prose intact", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop project only");
  await mockInvestigation(page);

  for (const width of [820, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    let overflow = await documentOverflow(page);
    expect(overflow.scrollWidth, `landing at ${width}px scrolls sideways`).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(tooSmall(await textSizes(page, BODY_SELECTORS.landing), BODY_MIN_PX)).toEqual([]);

    await runInvestigation(page);
    await revealFullStory(page);
    overflow = await documentOverflow(page);
    expect(overflow.scrollWidth, `result at ${width}px scrolls sideways`).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(tooSmall(await textSizes(page, BODY_SELECTORS.result), BODY_MIN_PX)).toEqual([]);
    expect(tooSmall(await textSizes(page, META_SELECTORS.result), META_MIN_PX), `metadata at ${width}px`).toEqual([]);

    const dialog = await openCase(page, dialogCases[0]);
    const box = await dialogBox(dialog);
    expect(Math.abs(box.left - (box.viewportWidth - box.right)), `dialog at ${width}px is off-centre`).toBeLessThanOrEqual(CENTER_TOLERANCE);
    await closeActive(page);
  }
});

test.describe("contrast", () => {
  // Reduced motion pins entrance animations, so a mid-fade opacity cannot be
  // scanned as a contrast failure.
  test.use({ reducedMotion: "reduce" });

  test("light and soft dark pass colour contrast on the landing, a result and every detail layer", async ({ page }) => {
    await mockInvestigation(page);
    await page.goto("/");

    const findings: string[] = [];
    const scan = async (label: string, include?: string) => {
      const builder = new AxeBuilder({ page }).withRules(["color-contrast"]);
      if (include) builder.include(include);
      findings.push(...formatViolations(label, await builder.analyze()));
    };
    const scanLayers = async (label: string) => {
      const dialog = await openCase(page, dialogCases[2]);
      for (const { tab, title } of layerTabs) {
        await selectLayer(page, dialog, tab, title);
        await openDisclosures(dialog);
        await scan(`${label} ${title} dialog`, "dialog[open]");
      }
      await closeActive(page);
      for (const dialogCase of [dialogCases[4], dialogCases[5], dialogCases[1]]) {
        await openCase(page, dialogCase);
        await scan(`${label} ${dialogCase.title} dialog`, "dialog[open]");
        await closeActive(page);
      }
    };

    await scan("landing light");
    await themeToggle(page, "dark").click();
    await expect.poll(() => theme(page)).toBe("dark");
    await scan("landing soft dark");
    await themeToggle(page, "light").click();
    await expect.poll(() => theme(page)).toBe("light");

    await runInvestigation(page);
    await revealFullStory(page);
    await scan("result light");
    await scanLayers("light");

    await themeToggle(page, "dark").click();
    await expect.poll(() => theme(page)).toBe("dark");
    await scan("result soft dark");
    await scanLayers("soft dark");

    expect(findings).toEqual([]);
  });
});
