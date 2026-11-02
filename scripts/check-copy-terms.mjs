/**
 * Keeps two vocabulary rules that review kept catching by hand.
 *
 *   1. US English. British spellings (colour, centre, programme, catalogue,
 *      labelled, behaviour, ...) crept into copy, comments, and test names.
 *      `aria-labelledby` and `labelledBy` are the platform's own spelling.
 *   2. Vendor-neutral live production. The studio speaks of "browser
 *      sources", "production software", and "switchers"; naming a specific
 *      production tool ties copy, identifiers, and contracts to one vendor.
 *
 * Content and data trees hold quoted source text, and applied migrations
 * cannot change, so neither is scanned.
 *
 * Usage: node scripts/check-copy-terms.mjs [file ...]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const scannedTrees = ["assets", "functions", "scripts", "site", "static", "tests", ":(glob)*.md"];

// A British stem, and what may not follow it ("programmer" is US English too).
const britishStems = [
  ["colour"],
  ["centre"],
  ["programme", "r"],
  ["catalogue"],
  ["behaviour"],
  ["honour"],
  ["favourite"],
  ["organis", "m"],
  ["recognis"],
  ["normalis"],
  ["initialis"],
  ["analys", "[^e]"],
  ["labelled"],
  ["labelling"],
  ["cancelation"],
];

// Match a stem as a word or a camelCase part (pageColours, PAGE_COLOURS) but
// not inside another word: recentResult holds "centRe", ProgramMessage "programMe".
function stemPattern([stem, notFollowedBy]) {
  const capitalized = stem[0].toUpperCase() + stem.slice(1);
  const after = notFollowedBy ? `(?!${notFollowedBy})` : "";
  return `(?:(?<![A-Za-z])${stem}|${capitalized}|${stem.toUpperCase()})${after}`;
}

export const copyTermRules = [
  {
    name: "US English",
    pattern: new RegExp(britishStems.map(stemPattern).join("|")),
    allowed: /aria-labelledby|labelledBy/g,
  },
  { name: "vendor-neutral production", pattern: /\bOBS\b|\b[vV][mM]ix\b/ },
];

// The gate and its test name the refused terms on purpose.
const ownFiles = new Set(["scripts/check-copy-terms.mjs", "tests/tools/copy-terms.test.ts"]);

/** Return one finding per rule that a line breaks. */
export function copyTermFindings(line) {
  return copyTermRules.flatMap((rule) => {
    const text = rule.allowed ? line.replace(rule.allowed, "") : line;
    const match = text.match(rule.pattern);
    return match ? [{ rule: rule.name, term: match[0] }] : [];
  });
}

function trackedFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...scannedTrees],
    { encoding: "utf8" },
  );
  return output
    .split("\0")
    .filter(
      (file) =>
        file &&
        existsSync(file) &&
        !ownFiles.has(file) &&
        !/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf)$/i.test(file),
    );
}

function main(files) {
  const failures = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const finding of copyTermFindings(line))
        failures.push(`${file}:${index + 1} ${finding.rule}: "${finding.term}"`);
    });
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    console.error(
      `\n${failures.length} line(s) break the copy terms. Use US English and vendor-neutral production terms.`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const named = process.argv.slice(2);
  main(named.length ? named.filter((file) => !ownFiles.has(file)) : trackedFiles());
}
