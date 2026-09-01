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

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const GATE = "scripts/check-design-isolation.mjs";
const paths = process.argv.slice(2);

if (paths.length === 0) {
  console.error("usage: node scripts/adopt-design-surfaces.mjs <path>...");
  process.exit(1);
}

const source = readFileSync(GATE, "utf8");
const already = new Set([...source.matchAll(/^\s*"([^"]+)",$/gm)].map((match) => match[1]));

const report = execFileSync("node", [GATE, "--by-file"], { encoding: "utf8" });
const dirty = paths.filter((path) => report.includes(path));
if (dirty.length > 0) {
  console.error("still reference Bootstrap, refusing to adopt:");
  for (const path of dirty) console.error(`  ${path}`);
  process.exit(1);
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
