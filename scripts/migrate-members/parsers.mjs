/**
 * Raw ingestion: turns files on disk (YAML member records, roster CSV
 * exports) and small content fragments into plain data. No reconciliation,
 * no SQL, no reporting — see reconciliation.mjs/sql-renderer.mjs/report.mjs
 * for those.
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { resolveMarkdownShortcodes } from "../../assets/shared/markdown-shortcodes.ts";

export function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

/**
 * Each roster export has a non-CSV title line, then a real header line,
 * then data rows. Nickname (column 2) is occasionally quoted with an
 * embedded comma (e.g. "Dholakia, Sandip") — a tiny quote-aware splitter
 * handles that.
 */
export function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/** Returns a Map<normalizedEmail, { joinSortKey: string }> for one roster CSV. */
export function loadRosterCsv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  // lines[0] = title ("Members for group X"), lines[1] = header, lines[2+] = data
  const byEmail = new Map();

  for (let i = 2; i < lines.length; i += 1) {
    const fields = parseCsvLine(lines[i]);
    const email = normalizeEmail(fields[0] ?? "");
    if (!email || !email.includes("@")) continue;

    const [, , , , , , year, month, day, hour, minute, second] = fields;
    const joinSortKey = [year, month, day, hour, minute, second]
      .map((v) => String(Number.parseInt(v ?? "0", 10) || 0).padStart(4, "0"))
      .join("-");

    // Last-write-wins is fine: duplicate emails in an export are the same
    // person; we just need *a* join timestamp for ordering purposes.
    byEmail.set(email, { joinSortKey });
  }

  return byEmail;
}

/**
 * Excludes hidden files (dotfiles, including macOS AppleDouble sidecar
 * files like `._acme.yaml` created when a directory is copied off an
 * HFS+/APFS volume onto a non-Apple filesystem) and non-regular files
 * (directories, symlinks, sockets) — only a real `.yaml`/`.yml` file with
 * a visible name is a member record.
 */
export function loadMemberYamlFiles(membersDir) {
  const files = fs
    .readdirSync(membersDir)
    .filter((f) => (f.endsWith(".yaml") || f.endsWith(".yml")) && !f.startsWith("."))
    .filter((f) => fs.statSync(path.join(membersDir, f)).isFile());
  return files.map((filename) => {
    const raw = fs.readFileSync(path.join(membersDir, filename), "utf8");
    const doc = YAML.parse(raw) ?? {};
    return { filename, slug: path.basename(filename, path.extname(filename)), doc };
  });
}

/**
 * A rep with `till` set no longer represents the org (from/till
 * convention) — excluded from user/member creation, but still real
 * historical content (attribution on blog posts etc.), so the YAML stays
 * untouched; this just skips minting a portal account for them.
 */
export function activeRepresentatives(doc) {
  const reps = Array.isArray(doc.representatives) ? doc.representatives : [];
  return reps.filter((r) => r && typeof r.name === "string" && r.name.trim().length > 0 && !r.till);
}

/**
 * Rewrites Hugo shortcodes found in YAML `content` fields into plain URLs,
 * since `organizations.content_markdown` is rendered as Markdown, not Hugo
 * template syntax.
 *
 * The rule itself is not written here. It lives in the shared registry the
 * Markdown renderer also reads (`assets/shared/markdown-shortcodes.ts`), so
 * the importer and the page cannot disagree about what a given shortcode
 * means — this file used to keep its own three regular expressions, and a
 * shortcode the renderer had never heard of was exactly issue #12.
 */
export function convertHugoShortcodes(content) {
  if (!content) return content;
  return resolveMarkdownShortcodes(String(content));
}

export function splitName(fullName) {
  const tokens = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: null, lastName: null };
  if (tokens.length === 1) return { firstName: tokens[0], lastName: null };
  return { firstName: tokens.slice(0, -1).join(" "), lastName: tokens[tokens.length - 1] };
}

/** Mirrors Hugo's `urlize`: lowercase, strip diacritics, non-alphanumerics -> hyphens. */
export function urlizeName(name) {
  return String(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining diacritical marks left behind by NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
