/**
 * Emits assets/design/tokens.generated.css from the token module.
 *
 * The generated stylesheet is committed so Hugo, the Marp theme, and any
 * consumer that only speaks CSS can read it without running a build first.
 * That only stays honest if drift is caught, so `--check` re-renders and
 * compares instead of writing; `pnpm run check` runs it in that mode.
 *
 * Usage:
 *   node --experimental-strip-types scripts/build-design-tokens.mjs
 *   node --experimental-strip-types scripts/build-design-tokens.mjs --check
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { emitTokenCss } from "../assets/design/emit-css.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "assets", "design", "tokens.generated.css");
const shown = relative(root, target);
const checkOnly = process.argv.includes("--check");

const rendered = emitTokenCss();

if (!checkOnly) {
  writeFileSync(target, rendered);
  console.log(`[design-tokens] wrote ${shown} (${rendered.length} bytes)`);
  process.exit(0);
}

if (!existsSync(target)) {
  console.error(`[design-tokens] ${shown} is missing. Run \`pnpm run build:tokens\`.`);
  process.exit(1);
}

const current = readFileSync(target, "utf8");
if (current !== rendered) {
  console.error(
    `[design-tokens] ${shown} is out of date with assets/design/tokens.ts.\n` +
      "Run `pnpm run build:tokens` and commit the result.",
  );
  process.exit(1);
}

console.log(`[design-tokens] ${shown} matches the token module`);
