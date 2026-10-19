/**
 * Fails any component stylesheet that declares a rule outside a cascade layer.
 *
 * Usage: node scripts/check-css-layers.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const failures = [];

/**
 * Top-level rules a stylesheet declares outside any cascade layer.
 *
 * An unlayered rule beats every layered one whatever its specificity, so one
 * component stylesheet left outside `@layer components` silently outranks the
 * utilities and every other component, and moving it in later becomes a
 * cascade audit. Every component stylesheet the bundles import is held to it,
 * not only the adopted surfaces: the published agenda was the last holdout.
 * Font faces, keyframes and property registrations declare nothing that
 * competes, so they may stand at the top level.
 */
function unlayeredRuleLines(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const lines = [];
  let depth = 0;
  let prelude = "";
  let line = 1;
  let preludeLine = 1;
  for (const character of code) {
    if (character === "\n") line++;
    if (character === "{") {
      if (depth === 0) {
        const head = prelude.trim();
        if (head && !/^@(layer|font-face|keyframes|property)\b/.test(head)) lines.push(preludeLine);
      }
      depth++;
      prelude = "";
    } else if (character === "}") {
      depth = Math.max(0, depth - 1);
      prelude = "";
    } else if (character === ";" && depth === 0) {
      prelude = "";
    } else {
      if (depth === 0 && !prelude.trim() && character.trim()) preludeLine = line;
      prelude += character;
    }
  }
  return lines;
}

function layerAudit(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      layerAudit(full);
      continue;
    }
    if (!/\.(css|scss)$/.test(entry) || /\.generated\.css$/.test(entry)) continue;
    const text = readFileSync(full, "utf8");
    // Sass line comments carry no rules; blank them so their words are not read as a selector.
    const source = entry.endsWith(".scss") ? text.replace(/(^|[^:])\/\/[^\n]*/g, "$1") : text;
    for (const lineNumber of unlayeredRuleLines(source)) {
      failures.push(
        `${relative(root, full)}:${lineNumber}  declares a rule outside a cascade layer\n    ${(text.split("\n")[lineNumber - 1] ?? "").trim()}`,
      );
    }
  }
}

for (const dir of ["assets/ts", "assets/design"]) layerAudit(resolve(root, dir));

if (failures.length) {
  console.error(
    `[css-layers] ${String(failures.length)} rule(s) outside a cascade layer:\n\n${failures.join("\n\n")}\n`,
  );
  console.error("Wrap component rules in @layer components; see assets/design/tokens.ts for the layer order.");
  process.exit(1);
}
console.log("[css-layers] every component stylesheet declares its rules inside a cascade layer");
