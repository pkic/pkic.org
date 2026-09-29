import { describe, expect, it } from "vitest";
import {
  assertFrontendBundleBudget,
  FRONTEND_BUNDLE_BUDGETS,
  inspectFrontendBundleChunks,
} from "../../scripts/lib/frontend-bundle-budget.mjs";

describe("frontend bundle budget", () => {
  it("measures every entry and lazy chunk using raw and gzip sizes", () => {
    const result = inspectFrontendBundleChunks([
      { fileName: "loader.js", isEntry: true, code: "export const entry = true;" },
      { fileName: "chunks/events.js", isEntry: false, code: "export const events = true;" },
    ]);
    const measurements = result.measurements as Array<{
      fileName: string;
      kind: "entry" | "chunk";
      rawBytes: number;
      gzipBytes: number;
    }>;

    expect(result.violations).toEqual([]);
    expect(measurements.map(({ fileName, kind }) => ({ fileName, kind }))).toEqual([
      { fileName: "chunks/events.js", kind: "chunk" },
      { fileName: "loader.js", kind: "entry" },
    ]);
    expect(measurements.every(({ rawBytes, gzipBytes }) => rawBytes > 0 && gzipBytes > 0)).toBe(true);
  });

  it("rejects an oversized eager entry", () => {
    const oversized = "x".repeat(FRONTEND_BUNDLE_BUDGETS.entry.rawBytes + 1);
    expect(() => assertFrontendBundleBudget([{ fileName: "loader.js", isEntry: true, code: oversized }])).toThrow(
      /loader\.js: raw/,
    );
  });

  it("rejects an oversized lazy chunk", () => {
    const oversized = "x".repeat(FRONTEND_BUNDLE_BUDGETS.chunk.rawBytes + 1);
    expect(() =>
      assertFrontendBundleBudget([{ fileName: "chunks/portal.js", isEntry: false, code: oversized }]),
    ).toThrow(/chunks\/portal\.js: raw/);
  });
});
