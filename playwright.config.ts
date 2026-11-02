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
  testIgnore: [
    "**/._*",
    "**/astro-publication.spec.ts",
    "**/public-contrast.spec.ts",
    "**/public-publication-layout.spec.ts",
    "**/public-responsive.spec.ts",
    "**/public-form-and-theme-layout.spec.ts",
  ],
  // Whole-site republication variants are an explicit audit, not routine UI CI.
  grepInvert: /@publication/,
  timeout: 120_000,
  // Several shards share one machine, so a portal screen can take longer than Playwright's five-second default to settle.
  expect: { timeout: 15_000 },
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
    // Let the release supervisor stop its Worker process group and close logs.
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
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
     * Opt in to what slows a run down. A film of every test, and a pause after every action, make a
     * suite that should take minutes take hours; nobody watches a passing test. Set PWVIDEO=1 to
     * keep a video of each failing test, and PWSLOW=<milliseconds> to pause after each action when
     * watching a run. Screenshots and traces of failures are always kept.
     */
    video: process.env.PWVIDEO ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      slowMo: process.env.CI ? 0 : Number(process.env.PWSLOW ?? 0),
    },
  },
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
});
