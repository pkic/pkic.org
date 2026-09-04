/**
 * Holds the flow inventory and the end-to-end specs to each other.
 *
 * The inventory in tests/e2e/flow-inventory.mjs says what this product's
 * flows are made of and which steps are walked in a browser. A claim there is
 * worth nothing unless something enforces it, so this fails when:
 *
 *   - a step marked "covered" has no spec claiming it, and
 *   - a spec claims a step the inventory does not define.
 *
 * It does not fail on a step marked "gap", "unit" or "absent". Those are
 * reported, every run, with a count — an inventory whose holes are visible is
 * the point, and a gate that went red for each of them would be turned off
 * within a week. What it does stop is a claim quietly becoming untrue: a spec
 * deleted or renamed takes its claim with it, and the step goes back to being
 * a gap in the open rather than a line nobody rechecked.
 *
 * Usage:
 *   node scripts/check-flow-coverage.mjs
 *   node scripts/check-flow-coverage.mjs --report   # inventory, without failing
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { FLOWS } from "../tests/e2e/flow-inventory.mjs";

const root = process.cwd();
const specDir = resolve(root, "tests", "e2e");
const reportOnly = process.argv.includes("--report");

const STATUS_ORDER = ["covered", "unit", "gap", "absent"];

function specFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) specFiles(full, files);
    else if (full.endsWith(".spec.ts")) files.push(full);
  }
  return files;
}

/** Every `@covers <flow>.<step>` claim, and the spec that makes it. */
const claims = new Map();
for (const file of specFiles(specDir)) {
  for (const match of readFileSync(file, "utf8").matchAll(/@covers\s+([a-z0-9-]+\.[0-9a-z.]+)/g)) {
    const id = match[1];
    if (!claims.has(id)) claims.set(id, []);
    claims.get(id).push(relative(root, file));
  }
}

const defined = new Map();
for (const flow of FLOWS) {
  for (const step of flow.steps) defined.set(`${flow.id}.${step.id}`, { flow, step });
}

const failures = [];

for (const [id, files] of claims) {
  if (!defined.has(id)) {
    failures.push(`  ${id} — claimed by ${files.join(", ")}, but no such step exists in the inventory`);
  }
}

for (const [id, { step }] of defined) {
  if (step.status === "covered" && !claims.has(id)) {
    failures.push(`  ${id} — "${step.title}" is marked covered, and no spec claims it`);
  }
}

const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
for (const [, { step }] of defined) counts[step.status] += 1;

/** Wraps a note so a long one stays readable when the report is pasted. */
function wrap(text, indent) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line.length + word.length + 1 > 96 - indent.length) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(indent + line);
  return lines.join("\n");
}

const MARKS = { covered: "[x]", unit: "[~]", gap: "[ ]", absent: "[-]" };

console.log("FLOW COVERAGE");
console.log("  [x] walked end to end   [~] tested below the browser   [ ] untested   [-] not built");
for (const flow of FLOWS) {
  console.log(`\n${"=".repeat(98)}`);
  console.log(flow.title);
  console.log(wrap(flow.purpose, "  "));
  console.log(`  Personas: ${flow.personas.join(", ")}\n`);
  for (const step of flow.steps) {
    console.log(`  ${MARKS[step.status]} ${step.id.padEnd(6)} ${step.title}`);
    const claimedBy = claims.get(`${flow.id}.${step.id}`);
    if (claimedBy) {
      console.log(`          walked by: ${claimedBy.map((file) => file.replace("tests/e2e/", "")).join(", ")}`);
    }
    if (step.note) console.log(wrap(step.note, "          "));
    console.log("");
  }
}
console.log(
  `\n  ${String(counts.covered)} walked end to end · ${String(counts.unit)} tested below the browser · ` +
    `${String(counts.gap)} untested · ${String(counts.absent)} not built`,
);

if (failures.length > 0 && !reportOnly) {
  console.error(`\nFlow coverage: ${String(failures.length)} claim(s) the specs do not keep.\n`);
  console.error(failures.join("\n"));
  console.error("\nEither claim the step from the spec that walks it, or change its status in the inventory.");
  process.exit(1);
}
process.exit(0);
