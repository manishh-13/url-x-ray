import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3099";
const localChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Prefer an explicit override, then a locally installed Chrome, then Playwright's
// bundled Chromium. This keeps the suite runnable on a machine where the browser
// download was skipped, without hard-coding a path that only exists on macOS.
const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const executablePath = fromEnv || (existsSync(localChrome) ? localChrome : undefined);

export default defineConfig({
  testDir: "./tests/e2e",
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
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      // A narrow viewport with touch, run in the same Chromium engine. iOS Safari
      // rendering is out of scope, so no WebKit project is defined.
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
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});
