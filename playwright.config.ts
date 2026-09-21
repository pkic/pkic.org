import { defineConfig } from "@playwright/test";
import { E2E_WORKER_COUNT } from "./scripts/e2e-admin-identities.mjs";

const e2ePort = Number(process.env.E2E_PORT ?? 8788);
// `localhost`, not `127.0.0.1`: WebAuthn refuses a ceremony whose origin is a
// bare IP, because an address is not a registrable domain the relying-party id
// can be a suffix of. See scripts/e2e-start.sh.
const e2eBaseUrl = `http://localhost:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  testIgnore: "**/._*",
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  /*
   * Stop a shard after its first persistent failure.
   *
   * Passing runs still exercise every flow. Failed runs retain one retry and
   * the full artifact bundle, then stop instead of spending scarce CI minutes
   * collecting downstream failures from a commit that already cannot merge.
   */
  maxFailures: process.env.CI ? 1 : undefined,
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
    /*
     * The server's own output, kept.
     *
     * Playwright discards it by default. When this Worker dies mid-run — which
     * it does — every test after it fails with ERR_CONNECTION_REFUSED and the
     * one line saying why has already been thrown away. A run that reports
     * fifty failures and no cause is not a run anybody can act on.
     */
    stdout: "pipe",
    stderr: "pipe",
  },
  use: {
    baseURL: e2eBaseUrl,
    // A stale selector must not consume the full two-minute scenario timeout.
    // Twenty seconds still leaves ample room for a real Worker-backed action.
    actionTimeout: process.env.CI ? 20_000 : 0,
    /*
     * Recorded only for the runs that need explaining. `video: "on"` wrote a
     * film of all 111 tests every run — 280MB a run into the system temp
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
