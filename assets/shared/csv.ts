const FORMULA_PREFIX = /^\s*[=+\-@]/u;

export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\r\n]/u.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
