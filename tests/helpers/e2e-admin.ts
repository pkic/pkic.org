/**
 * Derives a per-Playwright-worker admin identity for E2E specs that sign in
 * for real via the magic-link flow. All parallel workers share one wrangler
 * dev server and D1 instance (scripts/e2e-start.sh), and EMAIL_RATE_LIMITER
 * (wrangler.jsonc) allows only 3 magic-link requests per 60s *per address* —
 * every spec hardcoding "admin@pkic.org" collided once run in parallel.
 * scripts/seed-initial-admin.mjs seeds one admin per CPU core using this same
 * naming scheme (worker 0 keeps the original "admin@pkic.org" for backward
 * compatibility; every other worker gets "admin.w<index>@pkic.org").
 */
export function e2eAdminEmail(): string {
  const index = process.env.TEST_PARALLEL_INDEX ?? "0";
  return index === "0" ? "admin@pkic.org" : `admin.w${index}@pkic.org`;
}
