/**
 * Parses freeform text into a deduplicated list of contacts.
 *
 * Supported formats:
 *  - `"First Last" <email>` or `First Last <email>`
 *  - `first,last,email` (CSV row)
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

export function parseContactText(raw: string): ParsedContact[] {
  const results: ParsedContact[] = [];
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);

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
        } else if (parts.length === 1) {
          entry.firstName = parts[0];
        }
      }
      results.push(entry);
      continue;
    }

    // CSV: first,last,email
    const csvParts = line.split(",").map((s) => s.trim());
    if (csvParts.length === 3 && csvParts[2].includes("@") && !csvParts[2].includes(" ")) {
      results.push({
        firstName: csvParts[0] || undefined,
        lastName: csvParts[1] || undefined,
        email: csvParts[2].toLowerCase(),
      });
      continue;
    }

    // Plain email list (comma/semicolon separated)
    const atoms = line.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
    for (const atom of atoms) {
      if (!atom.includes("@")) continue;
      const entry: ParsedContact = { email: atom.toLowerCase() };
      const local = atom.split("@")[0];
      const dotParts = local.split(".").filter(Boolean);
      if (dotParts.length >= 2) {
        entry.firstName = capitalizeWord(dotParts[0]);
        entry.lastName = capitalizeWord(dotParts.slice(1).join(" "));
      }
      results.push(entry);
    }
  }

  const seen = new Set<string>();
  return results.filter((e) => {
    if (seen.has(e.email)) return false;
    seen.add(e.email);
    return true;
  });
}
