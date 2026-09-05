/**
 * Fails an end-to-end spec that signs in more times on one address than the
 * application's own email rate limiter allows.
 *
 * `EMAIL_RATE_LIMITER` permits three sign-in link requests a minute for an
 * address. That is the product's rule and it is correct; the mistake is a spec
 * file whose tests all authenticate as the same scope identity, because
 * Playwright runs them back to back and the fourth one asks for a fourth link
 * inside the same minute. It then fails with "Too many requests" at a point
 * that has nothing to do with what it was testing — and, worse, it fails
 * *before* reaching its assertions, so a genuine regression underneath is
 * invisible until somebody runs that test alone.
 *
 * The fix is one address per scenario, which `E2E_ADMIN_SCOPES` already
 * provides; this only stops the file drifting back. The budget is the
 * limiter's own, so it cannot be wrong for the wrong reason: if the limit is
 * ever raised, raise it here from the same source.
 *
 * Usage:
 *   node scripts/check-e2e-signin-budget.mjs
 *   node scripts/check-e2e-signin-budget.mjs --report   # list without failing
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const specDir = resolve(root, "tests", "e2e");
const reportOnly = process.argv.includes("--report");

/** What `EMAIL_RATE_LIMITER` allows for one address in its window. */
const REQUESTS_PER_ADDRESS = 3;

function specFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) specFiles(full, files);
    else if (full.endsWith(".spec.ts")) files.push(full);
  }
  return files;
}

const overspent = [];
for (const file of specFiles(specDir)) {
  const source = readFileSync(file, "utf8");
  const uses = new Map();
  for (const match of source.matchAll(/e2eAdminEmail\(\s*"([^"]+)"\s*\)/g)) {
    const scope = match[1];
    uses.set(scope, (uses.get(scope) ?? 0) + 1);
  }
  for (const [scope, count] of uses) {
    if (count > REQUESTS_PER_ADDRESS) {
      overspent.push({ file: relative(root, file), scope, count });
    }
  }
}

if (overspent.length === 0) {
  console.log(
    `End-to-end sign-ins: no address is asked for more than ${String(REQUESTS_PER_ADDRESS)} links in a file.`,
  );
  process.exit(0);
}

console.error(
  `End-to-end sign-ins: ${String(overspent.length)} address${overspent.length === 1 ? "" : "es"} over the limiter's budget.\n`,
);
for (const { file, scope, count } of overspent) {
  console.error(`  ${scope} — signed in ${String(count)} times, limit ${String(REQUESTS_PER_ADDRESS)}`);
  console.error(`    ${file}`);
  console.error(`    Give each scenario its own scope in scripts/e2e-admin-identities.mjs.\n`);
}
process.exit(reportOnly ? 0 : 1);
