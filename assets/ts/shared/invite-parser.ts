/**
 * Parses freeform text into a deduplicated list of contacts.
 *
 * Supported formats:
 *  - `"First Last" <email>` or `First Last <email>`
 *  - CSV with headers (email, first_name/firstName, last_name/lastName)
 *  - `first,last,email` or `email,first,last` (headerless CSV)
 *  - Plain email lists separated by commas, semicolons, or newlines
 *  - Infers names from `first.last@domain` patterns
 */

export interface ParsedContact {
  email: string;
  firstName?: string;
  lastName?: string;
}

function capitalizeWord(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

/** Infer first/last name from the local part of an email (e.g. first.last@domain). */
function inferNameFromEmail(entry: ParsedContact): void {
  if (entry.firstName) return;
  const local = entry.email.split("@")[0];
  const parts = local.split(".").filter(Boolean);
  if (parts.length >= 2) {
    entry.firstName = capitalizeWord(parts[0]);
    entry.lastName = capitalizeWord(parts.slice(1).join(" "));
  }
}

/** Split a single CSV line respecting quoted fields. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === "," || ch === "\t" || ch === ";") {
        fields.push(current.trim());
        current = "";
      } else current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

const EMAIL_COL = /^e[\s_-]?mail$/i;
const FIRST_COL = /^first[\s_-]?name$|^given[\s_-]?name$|^first$|^voornaam$/i;
const LAST_COL = /^last[\s_-]?name$|^family[\s_-]?name$|^surname$|^last$|^achternaam$/i;
const NAME_COL = /^name$|^full[\s_-]?name$|^naam$/i;

interface CsvMapping {
  email: number;
  first: number;
  last: number;
  fullName: number;
}

function detectHeaderMapping(fields: string[]): CsvMapping | null {
  let email = -1,
    first = -1,
    last = -1,
    fullName = -1;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i].replace(/^["']|["']$/g, "").trim();
    if (EMAIL_COL.test(f)) email = i;
    else if (FIRST_COL.test(f)) first = i;
    else if (LAST_COL.test(f)) last = i;
    else if (NAME_COL.test(f)) fullName = i;
  }
  return email >= 0 ? { email, first, last, fullName } : null;
}

export function parseContactText(raw: string): ParsedContact[] {
  const results: ParsedContact[] = [];
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  // Try to detect header row
  const firstFields = splitCsvLine(lines[0]);
  const mapping = detectHeaderMapping(firstFields);

  if (mapping) {
    // CSV with headers — parse remaining lines using the mapping
    for (let i = 1; i < lines.length; i++) {
      const fields = splitCsvLine(lines[i]);
      const email = fields[mapping.email]?.trim().toLowerCase();
      if (!email || !email.includes("@")) continue;
      const entry: ParsedContact = { email };
      if (mapping.first >= 0 && fields[mapping.first]?.trim()) entry.firstName = fields[mapping.first].trim();
      if (mapping.last >= 0 && fields[mapping.last]?.trim()) entry.lastName = fields[mapping.last].trim();
      if (!entry.firstName && mapping.fullName >= 0 && fields[mapping.fullName]?.trim()) {
        const parts = fields[mapping.fullName].trim().split(/\s+/);
        entry.firstName = parts[0];
        if (parts.length > 1) entry.lastName = parts.slice(1).join(" ");
      }
      inferNameFromEmail(entry);
      results.push(entry);
    }
  } else {
    // No header detected — use original heuristic parsing
    for (const line of lines) {
      // "First Last" <email>  or  First Last <email>
      const angleBracket = line.match(/^"?([^"<>]*)"?\s*<([^>]+)>\s*$/);
      if (angleBracket) {
        const namePart = angleBracket[1].trim();
        const email = angleBracket[2].trim().toLowerCase();
        if (!email.includes("@")) continue;
        const entry: ParsedContact = { email };
        if (namePart) {
          const parts = namePart.split(/\s+/).filter(Boolean);
          if (parts.length >= 2) {
            entry.firstName = parts[0];
            entry.lastName = parts.slice(1).join(" ");
          } else if (parts.length === 1) entry.firstName = parts[0];
        }
        results.push(entry);
        continue;
      }

      // CSV-like row: detect which field contains email
      const csvParts = splitCsvLine(line);
      if (csvParts.length >= 3) {
        const emailIdx = csvParts.findIndex((p) => p.includes("@") && !p.includes(" "));
        if (emailIdx >= 0) {
          const nonEmail = csvParts.filter((_, i) => i !== emailIdx);
          const entry: ParsedContact = {
            firstName: nonEmail[0] || undefined,
            lastName: nonEmail[1] || undefined,
            email: csvParts[emailIdx].toLowerCase(),
          };
          inferNameFromEmail(entry);
          results.push(entry);
          continue;
        }
      }

      // Plain email list (comma/semicolon separated)
      const atoms = line
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const atom of atoms) {
        if (!atom.includes("@")) continue;
        const entry: ParsedContact = { email: atom.toLowerCase() };
        inferNameFromEmail(entry);
        results.push(entry);
      }
    }
  }

  const seen = new Set<string>();
  return results.filter((e) => {
    if (seen.has(e.email)) return false;
    seen.add(e.email);
    return true;
  });
}
