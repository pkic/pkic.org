/** Google Groups exports, including spreadsheet-saved UTF-16/tab-delimited files. */
import fs from "node:fs";

export function parseCsvRecords(raw, separator = ",") {
  const rows = [];
  let fields = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '"') {
      if (quoted && raw[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (!quoted && ch === separator) {
      fields.push(field);
      field = "";
    } else if (!quoted && (ch === "\n" || ch === "\r")) {
      fields.push(field);
      if (fields.some((value) => value.trim())) rows.push(fields);
      fields = [];
      field = "";
      if (ch === "\r" && raw[i + 1] === "\n") i += 1;
    } else field += ch;
  }
  if (quoted) throw new Error("Unclosed quoted field in roster export");
  fields.push(field);
  if (fields.some((value) => value.trim())) rows.push(fields);
  return rows;
}

export function parseCsvLine(line) {
  return parseCsvRecords(line, ",")[0] ?? [""];
}

const headerKey = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[ _-]+/g, "");
const emailHeaders = new Set(["email", "emailaddress", "memberemail", "memberemailaddress"]);

export function loadRosterCsv(filePath, { allowEmpty = false } = {}) {
  const bytes = fs.readFileSync(filePath);
  if (allowEmpty && bytes.length === 0) return new Map();
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  const raw = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  if (raw.includes("\0")) throw new Error(`Unsupported roster encoding: ${filePath}`);
  let parsed;
  for (const separator of [",", "\t", ";"]) {
    const rows = parseCsvRecords(raw, separator);
    const headerIndex = rows.slice(0, 2).findIndex((row) => row.some((cell) => emailHeaders.has(headerKey(cell))));
    if (headerIndex >= 0) {
      parsed = { rows, headerIndex };
      break;
    }
  }
  if (!parsed) throw new Error(`Missing Email header in roster export: ${filePath}`);
  const { rows, headerIndex } = parsed;
  const header = rows[headerIndex].map(headerKey);
  const emailIndex = header.findIndex((cell) => emailHeaders.has(cell));
  const dateIndexes = ["year", "month", "day", "hour", "minute", "second"].map((name) =>
    header.findIndex((key) => key === name || key === `join${name}` || key === `joined${name}`),
  );
  const byEmail = new Map();
  for (const fields of rows.slice(headerIndex + 1)) {
    const email = (fields[emailIndex] ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    // Never accept a whole tab-delimited row as an address: that silently
    // created users whose domains could not match a single YAML record.
    if (!/^[^\s@<>]+@[^\s@<>]+$/.test(email)) {
      throw new Error(`Invalid email field in roster export ${filePath}, row ${rows.indexOf(fields) + 1}`);
    }
    const joinSortKey = dateIndexes
      .map((index) => String(Number.parseInt(fields[index] ?? "0", 10) || 0).padStart(4, "0"))
      .join("-");
    const hasJoinDate = dateIndexes.every((index) => index >= 0) && dateIndexes.some((index) => fields[index]?.trim());
    const joinDate = hasJoinDate
      ? Object.fromEntries(
          ["year", "month", "day", "hour", "minute", "second"].map((key, index) => [
            key,
            Number(fields[dateIndexes[index]]),
          ]),
        )
      : null;
    byEmail.set(email, { joinSortKey, joinDate, timeZone: fields[header.indexOf("timezone")]?.trim() ?? null });
  }
  return byEmail;
}
