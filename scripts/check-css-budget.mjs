/**
 * CSS bundle budget check.
 *
 * Hugo compiles assets/scss/main.scss to public/scss/main.css (or, in a
 * production build, a content-fingerprinted public/scss/main.<hash>.css).
 * That compiled output only exists after a Hugo build has run, so this
 * script locates it rather than compiling Sass itself — it is meant to run
 * right after `pnpm run generate:public` (or a production `vite build`),
 * which is how it's wired into `pnpm run check`.
 *
 * Usage:
 *   node scripts/check-css-budget.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCssBudget } from "./lib/frontend-bundle-budget.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const cssDir = resolve(root, "public", "scss");

function findCompiledMainCss() {
  // Development/generate:public builds write the unhashed filename.
  const plainPath = join(cssDir, "main.css");
  if (existsSync(plainPath)) {
    return plainPath;
  }

  // Production builds fingerprint the filename (main.<hash>.css). Pick the
  // most recently written match — a clean production build only leaves one.
  if (!existsSync(cssDir)) {
    return null;
  }
  const fingerprintedMatches = readdirSync(cssDir)
    .filter((fileName) => /^main\.[0-9a-f]+\.css$/.test(fileName))
    .map((fileName) => {
      const filePath = join(cssDir, fileName);
      return { filePath, mtimeMs: statSync(filePath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return fingerprintedMatches[0]?.filePath ?? null;
}

const cssPath = findCompiledMainCss();
if (!cssPath) {
  console.error(
    `[css-budget] No compiled stylesheet found under ${resolve(root, "public", "scss")}.\n` +
      "Run `pnpm run generate:public` (or a production build) first so Hugo compiles assets/scss/main.scss.",
  );
  process.exit(1);
}

const code = readFileSync(cssPath, "utf8");

try {
  const result = assertCssBudget(code);
  console.log(
    `[css-budget] ${relativeToRoot(cssPath)} passes: raw ${(result.rawBytes / 1024).toFixed(2)} KiB, gzip ${(result.gzipBytes / 1024).toFixed(2)} KiB`,
  );
} catch (error) {
  console.error(`[css-budget] ${relativeToRoot(cssPath)}\n${error.message}`);
  process.exit(1);
}

function relativeToRoot(absolutePath) {
  return absolutePath.slice(root.length + 1);
}
