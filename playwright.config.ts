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
    /*
     * The seeded database and the Wrangler state go wherever `E2E_STATE_ROOT`
     * says, defaulting to the system temp directory. On this machine that is
     * the nearly-full internal disk, so a caller can point it at roomier
     * storage without editing the script.
     */
    url: e2eBaseUrl,
    // Always start fresh so Wrangler uses the seeded state dir.
    reuseExistingServer: Boolean(process.env.REUSE_SERVER),
    timeout: 300_000,
  },
  use: {
    baseURL: e2eBaseUrl,
    /*
     * Recorded only for the runs that need explaining. `video: "on"` wrote a
     * film of all 111 tests every run — 280MB an run into the system temp
     * directory, which is on the internal disk and is what ran it out of space
     * mid-suite, taking the test server down with it. A passing test's video
     * is watched by nobody.
     */
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // Slow down actions locally so each step is visible; set PWSLOW=0 to disable.
    launchOptions: {
      slowMo: process.env.CI ? 0 : Number(process.env.PWSLOW ?? 800),
    },
  },
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
});
