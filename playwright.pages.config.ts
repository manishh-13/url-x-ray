import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { basePathFromEnv } from "./scripts/base-path.mjs";

/**
 * The static shell, checked the way a static host serves it.
 *
 * This config is separate from playwright.config.ts on purpose: it tests a
 * different artifact (pages-app/out) on a different port, and it assumes the
 * export already exists, so it never triggers a build. The local suite ignores
 * pages*.spec.ts and this suite runs nothing else.
 */
const basePath = basePathFromEnv();
const origin = `http://127.0.0.1:${process.env.PAGES_PREVIEW_PORT ?? 3100}`;
const baseURL = `${origin}${basePath}/`;

const localChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const executablePath = fromEnv || (existsSync(localChrome) ? localChrome : undefined);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "pages*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: executablePath ? { executablePath } : {},
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    {
      // Same engine, narrow viewport with touch, matching the local config. The
      // hosted edition adds capability copy and local-only panels, and those are
      // the parts most likely to break a small layout.
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
  ],

  webServer: {
    command: "npm run preview:pages",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
