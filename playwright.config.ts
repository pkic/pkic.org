import { defineConfig } from "@playwright/test";

const e2ePort = Number(process.env.E2E_PORT ?? 8788);
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  testIgnore: "**/._*",
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // The local SendGrid interceptor and seeded D1 state are shared by the E2E
  // files. Keep one worker so a test cannot clear or mutate another test's
  // outbox/database while it is waiting for an assertion.
  workers: 1,
  globalSetup: "./tests/e2e/global-setup.ts",
  webServer: {
    command: "sh scripts/e2e-start.sh",
    url: e2eBaseUrl,
    // Always start fresh so Wrangler uses the seeded state dir.
    reuseExistingServer: Boolean(process.env.REUSE_SERVER),
    timeout: 300_000,
  },
  use: {
    baseURL: e2eBaseUrl,
    video: "on",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // Slow down actions locally so each step is visible; set PWSLOW=0 to disable.
    launchOptions: {
      slowMo: process.env.CI ? 0 : Number(process.env.PWSLOW ?? 800),
    },
  },
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
});
