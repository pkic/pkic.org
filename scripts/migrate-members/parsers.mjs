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

export { parseCsvLine, loadRosterCsv } from "./roster-csv.mjs";

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
