import { gzipSync } from "node:zlib";

export const FRONTEND_BUNDLE_BUDGETS = Object.freeze({
  entry: Object.freeze({ rawBytes: 24 * 1024, gzipBytes: 8 * 1024 }),
  chunk: Object.freeze({ rawBytes: 200 * 1024, gzipBytes: 45 * 1024 }),
});

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
