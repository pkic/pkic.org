import { AppError } from "./errors";

import { escapeCsvField } from "../../assets/shared/csv";
export { escapeCsvField } from "../../assets/shared/csv";

/**
 * A CSV built one row at a time that refuses a row once the file would pass
 * `maxBytes`, so an export stops before its rows outgrow the Worker's memory.
 */
export function boundedCsvWriter(maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("maxBytes must be a positive safe integer");
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let totalBytes = 0;
  return {
    push(fields: readonly unknown[]): void {
      const line = fields.map(escapeCsvField).join(",");
      totalBytes += encoder.encode(line).byteLength + (lines.length === 0 ? 0 : 2);
      if (totalBytes > maxBytes) {
        throw new AppError(413, "CSV_EXPORT_TOO_LARGE", `CSV export must not exceed ${maxBytes} bytes`);
      }
      lines.push(line);
    },
    /** Data rows written so far, after the header. */
    get rows(): number {
      return Math.max(lines.length - 1, 0);
    },
    toString(): string {
      return lines.join("\r\n");
    },
  };
}

export function encodeBoundedCsv(rows: Iterable<readonly unknown[]>, maxBytes: number): string {
  const csv = boundedCsvWriter(maxBytes);
  for (const fields of rows) csv.push(fields);
  return csv.toString();
}

export function csvResponse(csv: string, filename: string): Response {
  const safeFilename = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Cache-Control": "no-store",
    },
  });
}
