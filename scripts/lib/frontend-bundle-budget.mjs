import { gzipSync } from "node:zlib";

export const FRONTEND_BUNDLE_BUDGETS = Object.freeze({
  entry: Object.freeze({ rawBytes: 24 * 1024, gzipBytes: 8 * 1024 }),
  chunk: Object.freeze({ rawBytes: 200 * 1024, gzipBytes: 45 * 1024 }),
});

// Compiled size of assets/scss/main.scss (public/scss/main.css after a Hugo
// build).
//
// This was 640 KiB / 88 KiB, holding the status quo of ~591 KiB raw / ~80 KiB
// gzip, with a note saying it would come down once the Bootstrap migration
// trimmed the stylesheet. It has: removing the framework took the compiled
// sheet to 305 KiB raw / 47 KiB gzip, a little under half. The ceiling is
// lowered to match, so the space Bootstrap used to occupy cannot quietly
// fill back up.
export const FRONTEND_CSS_BUDGET = Object.freeze({ rawBytes: 340 * 1024, gzipBytes: 54 * 1024 });

/*
 * The design system's entry stylesheet: tokens, the base layer, the utilities,
 * and the few primitives whose class names appear in server-rendered Hugo
 * markup. It is linked on every page, so it has to stay small — and the
 * pressure on it is one-directional, because adding "just one more" component
 * is always locally convenient. This ceiling is what makes that a decision
 * rather than a drift.
 *
 * The numbers are the MINIFIED production artifact — 16.6 KiB raw / 4.2 KiB
 * gzip as of 2026-09. They used to be roughly double that, because the check
 * was reading whatever unminified file a dev build had left behind. The gate
 * measures the hashed production build now, so the ceiling is a statement
 * about what a visitor downloads.
 *
 * The headroom is small on purpose. This is a ceiling, not a budget to spend.
 *
 * Raised once, on 2026-09-01, from 20/5 KiB. Three primitives joined the entry
 * that day, and each for the reason this list exists to allow: a
 * server-rendered page writes its class names and cannot wait for a lazy chunk
 * without showing unstyled markup first.
 *
 *   Pager        the list pages' pagination, which had been rendering as a
 *                bulleted list since Bootstrap's markup stopped being styled
 *   ThemeToggle  the navbar control on every page; lazily loaded, all three of
 *                its icons show until the chunk lands
 *   Table        content tables authored in Markdown, which had been
 *                unreadable in the dark theme
 *
 * That is the whole justification. A fourth addition needs its own, in this
 * comment, or it does not belong in the entry.
 */
export const DESIGN_ENTRY_CSS_BUDGET = Object.freeze({ rawBytes: 24 * 1024, gzipBytes: 6 * 1024 });

function kilobytes(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

export function inspectFrontendBundleChunks(chunks, budgets = FRONTEND_BUNDLE_BUDGETS) {
  const measurements = chunks
    .map(({ fileName, isEntry, code }) => ({
      fileName,
      kind: isEntry ? "entry" : "chunk",
      rawBytes: Buffer.byteLength(code),
      gzipBytes: gzipSync(code).byteLength,
    }))
    .sort((left, right) => right.gzipBytes - left.gzipBytes);

  const violations = measurements.flatMap((measurement) => {
    const budget = budgets[measurement.kind];
    const exceeded = [];
    if (measurement.rawBytes > budget.rawBytes) {
      exceeded.push(`raw ${kilobytes(measurement.rawBytes)} > ${kilobytes(budget.rawBytes)}`);
    }
    if (measurement.gzipBytes > budget.gzipBytes) {
      exceeded.push(`gzip ${kilobytes(measurement.gzipBytes)} > ${kilobytes(budget.gzipBytes)}`);
    }
    return exceeded.length === 0 ? [] : [`${measurement.fileName}: ${exceeded.join(", ")}`];
  });

  return { measurements, violations };
}

export function assertFrontendBundleBudget(chunks, budgets = FRONTEND_BUNDLE_BUDGETS) {
  const result = inspectFrontendBundleChunks(chunks, budgets);
  if (result.violations.length > 0) {
    throw new Error(`Frontend bundle budget exceeded:\n${result.violations.map((line) => `- ${line}`).join("\n")}`);
  }
  return result;
}

export function inspectCssBudget(code, budget = FRONTEND_CSS_BUDGET) {
  const rawBytes = Buffer.byteLength(code);
  const gzipBytes = gzipSync(code).byteLength;
  const violations = [];
  if (rawBytes > budget.rawBytes) {
    violations.push(`raw ${kilobytes(rawBytes)} > ${kilobytes(budget.rawBytes)}`);
  }
  if (gzipBytes > budget.gzipBytes) {
    violations.push(`gzip ${kilobytes(gzipBytes)} > ${kilobytes(budget.gzipBytes)}`);
  }
  return { rawBytes, gzipBytes, violations };
}

export function assertCssBudget(code, budget = FRONTEND_CSS_BUDGET) {
  const result = inspectCssBudget(code, budget);
  if (result.violations.length > 0) {
    throw new Error(`CSS budget exceeded:\n${result.violations.map((line) => `- ${line}`).join("\n")}`);
  }
  return result;
}
