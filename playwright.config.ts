import { defineConfig } from "@playwright/test";
import { E2E_WORKER_COUNT } from "./scripts/e2e-admin-identities.mjs";

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
  /*
   * The local SendGrid interceptor and seeded D1 state are shared by the E2E
   * files, so one worker keeps a test from clearing or mutating another's
   * outbox or database while it waits on an assertion.
   *
   * The same constant sizes the seeded admin pool. They have to agree: a
   * worker slot with no seeded identity cannot sign in, and a seeded identity
   * no worker reaches is a row written for nothing.
   */
  workers: E2E_WORKER_COUNT,
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
