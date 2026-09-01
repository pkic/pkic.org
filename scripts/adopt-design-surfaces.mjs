/**
 * Adds surfaces to the isolation gate's `scanned` list.
 *
 * Adoption is the ratchet: once a path is in that list the gate demands zero
 * for it forever. This does the edit, but only for paths that are ALREADY at
 * zero — it refuses to adopt a surface that would fail, so the list can never
 * become a list of things we intend to fix.
 *
 *   node scripts/adopt-design-surfaces.mjs <path>...
 */

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const GATE = "scripts/check-design-isolation.mjs";
const paths = process.argv.slice(2);

if (paths.length === 0) {
  console.error("usage: node scripts/adopt-design-surfaces.mjs <path>...");
  process.exit(1);
}

const source = readFileSync(GATE, "utf8");
const already = new Set([...source.matchAll(/^\s*"([^"]+)",$/gm)].map((match) => match[1]));

/*
 * Run the real gate against the candidates, not the ranked report.
 *
 * `--by-file` prints only the twenty-five heaviest files, so a path that was
 * merely small looked clean and got adopted. It also checks less: the ranked
 * count is Bootstrap references alone, while the gate additionally rejects
 * undefined `pk-` classes, inline styles, colour and size literals, and
 * classes assigned at runtime. Adopting on the weaker signal is how
 * `event-registration-confirm.html` entered the list with nine Bootstrap
 * classes still in it.
 */
const probe = readFileSync(GATE, "utf8").replace(
  /const scanned = \[[\s\S]*?\n\];/,
  `const scanned = ${JSON.stringify(paths)};`,
);
if (!probe.includes("const scanned = [")) {
  console.error("could not build a probe: the scanned list is not shaped as expected");
  process.exit(1);
}
const probePath = join(tmpdir(), `adopt-probe-${String(process.pid)}.mjs`);
writeFileSync(probePath, probe);
try {
  execFileSync("node", [probePath], { encoding: "utf8", cwd: process.cwd() });
} catch (error) {
  console.error("the gate rejects these as they stand, refusing to adopt:\n");
  console.error(String(error.stdout ?? "") + String(error.stderr ?? ""));
  process.exit(1);
} finally {
  rmSync(probePath, { force: true });
}

const fresh = paths.filter((path) => !already.has(path));
if (fresh.length === 0) {
  console.log("[adopt] nothing to add; all given paths are already held at zero");
  process.exit(0);
}

// Appended to the end of the list, which is chronological: the order records
// how the migration actually went.
const marker = "\n];";
const index = source.indexOf(marker);
if (index === -1) throw new Error("could not find the end of the scanned list");
const addition = fresh.map((path) => `  "${path}",`).join("\n");
writeFileSync(GATE, `${source.slice(0, index)}\n${addition}${source.slice(index)}`);

console.log(`[adopt] ${String(fresh.length)} surface(s) now held at zero:`);
for (const path of fresh) console.log(`  ${path}`);
