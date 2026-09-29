import { AppError } from "./errors";

const FORMULA_PREFIX = /^\s*[=+\-@]/u;

export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\r\n]/u.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function encodeBoundedCsv(rows: Iterable<readonly unknown[]>, maxBytes: number): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("maxBytes must be a positive safe integer");
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let totalBytes = 0;

  for (const fields of rows) {
    const line = fields.map(escapeCsvField).join(",");
    totalBytes += encoder.encode(line).byteLength + (lines.length === 0 ? 0 : 2);
    if (totalBytes > maxBytes) {
      throw new AppError(413, "CSV_EXPORT_TOO_LARGE", `CSV export must not exceed ${maxBytes} bytes`);
    }
    lines.push(line);
  }
  return lines.join("\r\n");
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
