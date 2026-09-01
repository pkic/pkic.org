/**
 * Lists Bootstrap class names that the end-to-end specs select on.
 *
 * These are the landmines of the migration. A spec that locates an element by
 * `.card` or `input.form-control-sm` keeps passing right up until someone
 * migrates that surface, and then fails somewhere unrelated-looking. Neither
 * the unit tests nor the isolation gate can see the connection, because the
 * dependency runs from a test file to markup in a completely different tree.
 *
 * Run it before migrating a surface, and check whether any class you are about
 * to remove appears here. If it does, update the spec in the same change.
 *
 * Usage:
 *   node scripts/check-e2e-selectors.mjs            # list every one
 *   node scripts/check-e2e-selectors.mjs card btn   # only these classes
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const specDir = resolve(root, "tests", "e2e");
const wanted = process.argv.slice(2);

/*
 * Bootstrap families a spec is likely to reach for. Deliberately broader than
 * an exact class match: `form-control-sm` matters as much as `form-control`.
 *
 * `page-` covers the whole family, not just `page-item`. The isolation gate
 * already treats every `page-*` class as Bootstrap, and the two lists
 * disagreeing is how `page-heading` slipped through: two Playwright specs
 * selected on it, this reported nothing, and only a hand grep found them.
 */
const FAMILIES =
  /\.(btn|card|row|col|alert|badge|nav|navbar|modal|dropdown|form-control|form-select|form-check|form-label|form-text|input-group|invalid-feedback|valid-feedback|list-group|table|spinner-border|visually-hidden|text-muted|text-danger|text-success|fw-|fst-|d-none|d-flex|page-|pagination|accordion|offcanvas|toast|progress)[a-z0-9-]*\b/g;

const found = new Map();

/*
 * Every spec AND every helper they share.
 *
 * This used to read `*.spec.ts` in the top directory only, which missed
 * `tests/e2e/helpers/`. Those files hold the locators the most specs depend
 * on — the sign-in flow, the membership fixtures — so a class buried there
 * breaks more suites than one in any single spec, and this reported none of
 * them.
 */
function specFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...specFiles(full));
    else if (/\.ts$/.test(entry) && !entry.startsWith("._")) files.push(full);
  }
  return files;
}

for (const file of specFiles(specDir)) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      // Only look inside locator-ish calls, so a comment mentioning "card"
      // does not become a false alarm.
      if (!/locator\(|querySelector|\$\(|getBy/.test(line)) return;
      for (const match of line.matchAll(FAMILIES)) {
        const name = match[0].slice(1);
        if (wanted.length > 0 && !wanted.some((w) => name.startsWith(w))) continue;
        const list = found.get(name) ?? [];
        list.push(`${relative(root, file)}:${String(index + 1)}`);
        found.set(name, list);
      }
    });
}

if (found.size === 0) {
  console.log(
    wanted.length > 0
      ? `[e2e-selectors] No spec selects on: ${wanted.join(", ")}. Safe to migrate.`
      : "[e2e-selectors] No spec selects on a Bootstrap class.",
  );
  process.exit(0);
}

console.log("[e2e-selectors] End-to-end specs select on these Bootstrap classes:\n");
for (const [name, places] of [...found].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  .${name}  (${String(places.length)})`);
  for (const place of places.slice(0, 4)) console.log(`      ${place}`);
  if (places.length > 4) console.log(`      … and ${String(places.length - 4)} more`);
}
console.log("\nMigrating a surface that a spec locates this way breaks the spec.");
console.log("Update both in the same change.");
