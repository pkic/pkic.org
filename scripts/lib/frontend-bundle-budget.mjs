import { gzipSync } from "node:zlib";

export const FRONTEND_BUNDLE_BUDGETS = Object.freeze({
  entry: Object.freeze({ rawBytes: 24 * 1024, gzipBytes: 8 * 1024 }),
  chunk: Object.freeze({ rawBytes: 200 * 1024, gzipBytes: 45 * 1024 }),
});

// Compiled size of assets/scss/main.scss (public/scss/main.css after a Hugo
// build). This ceiling locks in the current status quo (~591 KiB raw /
// ~80 KiB gzip as of 2026-08) with a little headroom; it will be reduced
// once the Bootstrap migration trims the compiled stylesheet.
export const FRONTEND_CSS_BUDGET = Object.freeze({ rawBytes: 640 * 1024, gzipBytes: 88 * 1024 });

// The design system's entry stylesheet: tokens, the base layer, the utilities,
// and the few primitives whose class names appear in server-rendered Hugo
// markup. It is linked on every page, so it has to stay small — and the
// pressure on it is one-directional, because adding "just one more" component
// is always locally convenient. This ceiling is what makes that a decision
// rather than a drift.
//
// Raised from 32 KiB / 9 KiB once, deliberately, in 2026-09. The gate had done
// its job twice by then: it caught the syntax-highlight editor and the content
// shapes sitting in this sheet, and both moved out to component chunks. What
// remained and kept growing is what genuinely belongs here — Field in
// particular, which now draws the checkboxes, radios and switches Bootstrap
// used to draw, and the layout utilities the Hugo templates write directly.
// Verified before raising: no component stylesheet is present in the built
// entry (no pk-table, pk-menu, pk-dialog, pk-chart, pk-toast, pk-tabs,
// pk-stat-card, pk-empty-state, pk-datalist or pk-overlay-editor).
//
// The headroom is small on purpose. This is a ceiling, not a budget to spend.
export const DESIGN_ENTRY_CSS_BUDGET = Object.freeze({ rawBytes: 34 * 1024, gzipBytes: 9.5 * 1024 });

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
