import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  globalSetup: "./tests/e2e/global-setup.ts",
  webServer: {
    command: "sh scripts/e2e-start.sh",
    url: "http://127.0.0.1:8788",
    // Always start fresh so Wrangler uses the seeded state dir.
    reuseExistingServer: Boolean(process.env.REUSE_SERVER),
    timeout: 300_000,
  },
  use: {
    baseURL: "http://127.0.0.1:8788",
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