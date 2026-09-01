/**
 * Finds CSS rules whose last consumer has gone.
 *
 * Every migrated surface leaves some of the legacy stylesheets unreachable,
 * and unreachable CSS is worse than dead code: it still ships, and the next
 * person to read it cannot tell whether it matters. This lists class selectors
 * defined under assets/scss that nothing in the markup, the scripts or the
 * tests refers to any more.
 *
 * It reports; it does not delete. A selector can be reached in ways a grep
 * cannot see — a class built by string concatenation, a name written in
 * content rather than in a template — so the removal stays a judgement call.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir, match, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, match, found);
    else if (match.test(entry)) found.push(full);
  }
  return found;
}

const styleFiles = walk("assets/scss", /\.scss$/);
const consumerFiles = [
  ...walk("assets/ts", /\.(ts|tsx)$/),
  ...walk("assets/js", /\.js$/),
  ...walk("layouts", /\.html$/),
  ...walk("tests", /\.(ts|tsx|html)$/),
];

const consumers = consumerFiles.map((file) => readFileSync(file, "utf8")).join("\n");

/** Class names a stylesheet defines, ignoring the ones it only references. */
const defined = new Map();
for (const file of styleFiles) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/(?:^|[\s,>+~(])\.([a-zA-Z][\w-]*)/g)) {
    const name = match[1];
    if (!defined.has(name)) defined.set(name, new Set());
    defined.get(name).add(file);
  }
}

const dead = [];
for (const [name, files] of defined) {
  // A name used elsewhere in the stylesheets themselves (a mixin target, a
  // parent selector) is not dead just because no template writes it.
  if (consumers.includes(name)) continue;
  // `adm-form-pie-dot-3` is written as `adm-form-pie-dot-${index}`, so the
  // full name appears nowhere. If the stem is referenced, the family is live.
  const stem = name.replace(/-\d+$/, "");
  if (stem !== name && consumers.includes(stem)) continue;
  dead.push({ name, files: [...files] });
}

dead.sort((a, b) => a.name.localeCompare(b.name));

if (dead.length === 0) {
  console.log("[dead-styles] every class defined under assets/scss is still referenced");
  process.exit(0);
}

console.log(`[dead-styles] ${String(dead.length)} class selector(s) nothing refers to any more:\n`);
for (const { name, files } of dead) {
  console.log(`  .${name}  —  ${files.join(", ")}`);
}
console.log("\nEach is a candidate for deletion. Check for string-built class names first.");
