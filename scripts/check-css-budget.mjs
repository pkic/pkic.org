/**
 * Check the UI component stylesheet linked by the Worker-rendered document.
 *
 * The frontend build records that stylesheet in its asset manifest. There is
 * intentionally no legacy Sass bundle or Hugo output in this check.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCssBudget, DESIGN_ENTRY_CSS_BUDGET } from "./lib/frontend-bundle-budget.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const manifestPath = resolve(root, "public", "js", "built", "manifest.json");

if (!existsSync(manifestPath)) {
  console.error("[css-budget] No Vite asset manifest found. Run `pnpm run generate:public` first.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const stylesheets = manifest?.loader?.stylesheets;
if (!Array.isArray(stylesheets) || !stylesheets.length) {
  console.error("[css-budget] The Vite asset manifest does not contain loader stylesheets.");
  process.exit(1);
}
const sources = stylesheets.map(({ url }) => {
  if (typeof url !== "string" || !url.startsWith("/js/built/")) throw new Error("Invalid loader stylesheet URL");
  const path = resolve(root, "public", url.slice(1));
  if (!existsSync(path)) throw new Error(`The manifest stylesheet does not exist: ${url}`);
  return readFileSync(path, "utf8");
});
const cssUrl = stylesheets.map(({ url }) => url).join(", ");

// Dev output is not minified. Measure an approximation of the shipped bytes so
// this check is stable after either a development or production asset build.
const shippedCss = sources
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s+/g, " ")
  .replace(/\s*([{}:;,>])\s*/g, "$1")
  .replace(/;}/g, "}")
  .trim();

try {
  const result = assertCssBudget(shippedCss, DESIGN_ENTRY_CSS_BUDGET);
  console.log(
    `[css-budget] ${cssUrl} passes: raw ${(result.rawBytes / 1024).toFixed(2)} KiB, gzip ${(result.gzipBytes / 1024).toFixed(2)} KiB`,
  );
} catch (error) {
  console.error(`[css-budget] ${cssUrl}\n${error.message}`);
  process.exit(1);
}
