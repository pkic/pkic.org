import { describe, expect, it } from "vitest";
import { csvResponse, encodeBoundedCsv, escapeCsvField } from "../functions/_lib/csv";

describe("shared CSV encoding", () => {
  it("neutralizes spreadsheet formulas before applying CSV quoting", () => {
    expect(escapeCsvField("=2+2")).toBe("'=2+2");
    expect(escapeCsvField("  @SUM(1,2)")).toBe('"\'  @SUM(1,2)"');
    expect(escapeCsvField('Ada "A"')).toBe('"Ada ""A"""');
  });

  it("enforces the configured UTF-8 byte limit", () => {
    expect(() => encodeBoundedCsv([["é"]], 1)).toThrowError(
      expect.objectContaining({ status: 413, code: "CSV_EXPORT_TOO_LARGE" }),
    );
  });

  it("sanitizes the attachment filename and disables caching", () => {
    const response = csvResponse("a,b", "../unsafe name.csv");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename=".._unsafe_name.csv"');
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
