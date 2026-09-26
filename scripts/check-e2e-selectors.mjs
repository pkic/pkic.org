/**
 * Fails an end-to-end selector that no longer matches anything the site renders.
 *
 * This is the migration's quietest failure mode. A spec locates an element by
 * `div.event-flow-consent-card`; the surface moves to the design system and the
 * component starts rendering `pk-field` instead; the class stays behind in a
 * stylesheet, so every "is this class still used?" check says yes. The spec
 * keeps compiling, keeps looking reasonable in review, and times out ninety
 * seconds into a suite nobody runs to completion. Seven browser tests were
 * failing on exactly that, and on `fs-6` — a Bootstrap class that had not
 * existed since the framework was removed.
 *
 * So the question this asks is not "is the class defined?" but "does anything
 * put it in the document?" A class that only a stylesheet knows about cannot be
 * selected, because no element ever carries it.
 *
 * Usage:
 *   node scripts/check-e2e-selectors.mjs            # fail on unrenderable classes
 *   node scripts/check-e2e-selectors.mjs --report   # list them without failing
 *   node scripts/check-e2e-selectors.mjs --bootstrap  # the old survey, by family
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const specDir = resolve(root, "tests", "e2e");
const reportOnly = process.argv.includes("--report");
const bootstrapSurvey = process.argv.includes("--bootstrap");

/** Trees that can put a class on an element. Stylesheets deliberately are not. */
const RENDERING_TREES = ["layouts", "assets/ts", "assets/js"];

const FAMILIES =
  /\.(btn|card|row|col|alert|badge|nav|navbar|modal|dropdown|form-control|form-select|form-check|form-label|form-text|input-group|invalid-feedback|valid-feedback|list-group|table|spinner-border|visually-hidden|text-muted|text-danger|text-success|fs-|fw-|fst-|d-none|d-flex|page-|pagination|accordion|offcanvas|toast|progress)[a-z0-9-]*\b/g;

function walk(dir, test, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, test, files);
    else if (test.test(entry)) files.push(full);
  }
  return files;
}

/**
 * Every class the site can put on an element, plus the prefixes it builds.
 *
 * A name assembled at runtime — `pk-field--${state}`, `sponsor-lvl-${n}` —
 * cannot be resolved here, so its literal head is kept as a prefix and anything
 * starting with it is treated as renderable. Guessing the tail would invent
 * failures; ignoring the head would miss the whole family.
 */
function renderedClasses() {
  const exact = new Set();
  const prefixes = new Set();

  const attribute = /\bclass(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{"([^"]*)"\}|\{'([^']*)'\})/g;
  const runtime = /classList\.(?:add|remove|toggle|replace)\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
  const template = /`([^`]*\bpk-[^`]*)`/g;

  for (const tree of RENDERING_TREES) {
    let files;
    try {
      files = walk(resolve(root, tree), /\.(html|tsx?|js|mjs)$/);
    } catch {
      continue; // A tree that does not exist in this checkout.
    }
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const pattern of [attribute, runtime, template]) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(source)) !== null) {
          const value = match.slice(1).find((group) => group !== undefined) ?? "";
          // Hugo actions and JS expressions split a value into literal pieces;
          // each piece contributes whole tokens, and a piece cut off mid-token
          // contributes a prefix.
          const pieces = value.split(/\{\{[^}]*\}\}|\$\{[^}]*\}/);
          pieces.forEach((piece, index) => {
            const tokens = piece.split(/\s+/).filter(Boolean);
            tokens.forEach((token, position) => {
              const openEnded = index < pieces.length - 1 && position === tokens.length - 1 && !/\s$/.test(piece);
              if (openEnded) prefixes.add(token);
              else exact.add(token);
            });
          });
        }
      }
    }
  }
  return { exact, prefixes };
}

/** Class names an end-to-end spec selects on, with where it says them. */
function specClasses() {
  const uses = new Map();
  const selector = /(?:locator|querySelector(?:All)?)\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
  const hasClass = /toHaveClass\(\s*\/([^/]+)\//g;

  for (const file of walk(specDir, /\.ts$/)) {
    const rel = relative(root, file);
    const source = readFileSync(file, "utf8");
    source.split("\n").forEach((line, index) => {
      const record = (name) => {
        const at = `${rel}:${index + 1}`;
        if (!uses.has(name)) uses.set(name, new Set());
        uses.get(name).add(at);
      };

      selector.lastIndex = 0;
      let match;
      while ((match = selector.exec(line)) !== null) {
        const value = match.slice(1).find((group) => group !== undefined) ?? "";
        if (value.includes("${")) continue; // Built at runtime; not resolvable.
        // Attribute selectors carry dotted values of their own: the selector
        // input[name="speaker.1.lastName"] names one field, not three classes.
        // They come out before the class tokens go in.
        const classesOnly = value.replace(/\[[^\]]*\]/g, " ");
        for (const found of classesOnly.matchAll(/\.([A-Za-z][\w-]*)/g)) record(found[1]);
      }

      hasClass.lastIndex = 0;
      while ((match = hasClass.exec(line)) !== null) {
        // A class assertion is written as a regular expression; its literal
        // words are the class names, and the metacharacters are not. Escape
        // sequences go first: `\bpk-strong\b` splits into a word starting
        // with the `b` of `\b` unless the escape is removed as a unit.
        for (const word of match[1].replace(/\\[a-zA-Z]/g, " ").split(/[^\w-]+/)) {
          if (word.length > 1 && /[a-z]/.test(word)) record(word);
        }
      }
    });
  }
  return uses;
}

if (bootstrapSurvey) {
  const found = new Map();
  for (const file of walk(specDir, /\.ts$/)) {
    const rel = relative(root, file);
    for (const match of readFileSync(file, "utf8").matchAll(FAMILIES)) {
      const name = match[0].slice(1);
      if (!found.has(name)) found.set(name, new Set());
      found.get(name).add(rel);
    }
  }
  if (found.size === 0) console.log("No Bootstrap class names are selected on by the end-to-end specs.");
  for (const [name, files] of [...found].sort()) console.log(`${name}\n  ${[...files].sort().join("\n  ")}`);
  process.exit(0);
}

const { exact, prefixes } = renderedClasses();
const failures = [];

for (const [name, places] of [...specClasses()].sort()) {
  if (exact.has(name)) continue;
  if ([...prefixes].some((prefix) => name.startsWith(prefix))) continue;
  failures.push(`${name} — selected on, rendered by nothing\n    ${[...places].sort().join("\n    ")}`);
}

if (failures.length === 0) {
  console.log("End-to-end selectors: every class selected on is one the site renders.");
  process.exit(0);
}

console.error(
  `End-to-end selectors: ${failures.length} class${failures.length === 1 ? "" : "es"} selected on that nothing renders.\n`,
);
for (const failure of failures) console.error(`  ${failure}\n`);
process.exit(reportOnly ? 0 : 1);
