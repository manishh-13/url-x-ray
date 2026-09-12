import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  BODY_MIN_PX, BODY_SELECTORS, META_MIN_PX, META_SELECTORS,
  dialogBox, documentOverflow, formatViolations, mockInvestigation, runInvestigation,
  settledDialog, textSizes, theme, themeToggle, tooSmall,
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

test("text stays legible and nothing overflows sideways", async ({ page }) => {
  await mockInvestigation(page);
  await page.goto("/");

  const small: string[] = [];
  const collect = async (state: "landing" | "result" | "dialog") => {
    small.push(...tooSmall(await textSizes(page, BODY_SELECTORS[state]), BODY_MIN_PX));
    small.push(...tooSmall(await textSizes(page, META_SELECTORS[state]), META_MIN_PX));
  };
  const noSideScroll = async (where: string) => {
    const overflow = await documentOverflow(page);
    expect(overflow.scrollWidth, `${where} scrolls sideways`).toBeLessThanOrEqual(overflow.clientWidth + 1);
  };

  await collect("landing");
  await noSideScroll("landing");

  await runInvestigation(page);
  await collect("result");
  await noSideScroll("result");

  await openCase(page, dialogCases[2]);
  await collect("dialog");
  await closeActive(page);

  expect(small).toEqual([]);
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
    overflow = await documentOverflow(page);
    expect(overflow.scrollWidth, `result at ${width}px scrolls sideways`).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(tooSmall(await textSizes(page, BODY_SELECTORS.result), BODY_MIN_PX)).toEqual([]);

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

  test("light and soft dark pass colour contrast on the landing, a result and a dialog", async ({ page }) => {
    await mockInvestigation(page);
    await page.goto("/");
    const scan = (label: string, include?: string) => {
      const builder = new AxeBuilder({ page }).withRules(["color-contrast"]);
      if (include) builder.include(include);
      return builder.analyze().then((results) => formatViolations(label, results));
    };

    const findings: string[] = [];
    findings.push(...await scan("landing light"));

    await themeToggle(page, "dark").click();
    await expect.poll(() => theme(page)).toBe("dark");
    findings.push(...await scan("landing soft dark"));

    await themeToggle(page, "light").click();
    await expect.poll(() => theme(page)).toBe("light");
    await runInvestigation(page);
    findings.push(...await scan("result light"));

    await openCase(page, dialogCases[1]);
    findings.push(...await scan("privacy dialog light", "dialog[open]"));
    await closeActive(page);

    expect(findings).toEqual([]);
  });
});
