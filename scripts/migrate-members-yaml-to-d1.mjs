/**
 * Step 2/3/3b — Import member organizations & representatives to D1.
 *
 * Reads `data/members/*.yaml` (the Hugo-era member directory) and the
 * Google Groups roster exports under `csv/` (`pkic.csv` plus the six
 * per-working-group rosters), reconciles them by email domain, and
 * generates idempotent SQL that:
 *
 *   - upserts one `organizations` row per org-tied YAML file (categories
 *     A-G, H1-H4, H8), populating the content columns plus
 *     `member_since` (migration 0046) from the YAML `memberSince` key
 *   - upserts one `users` + `members` row per representative whose email
 *     could be matched against the `pkic.csv` roster by organization
 *     domain (Step 2)
 *   - upserts one `users` + `members` row for **every** org-less individual
 *     (H5/H6/H7) YAML file, even when no roster email matches its domain —
 *     an individual with no reconcilable email still gets a real row, keyed
 *     on a deterministic, non-deliverable `.invalid`-TLD placeholder email
 *     (`unmatched-<slug>@members.invalid`, same "sentinel email" pattern
 *     `user-merge.ts` already uses for anonymized accounts) so the person,
 *     their bio/role, and their photo show up immediately; flagged
 *     `needsEmail: true` in the report so staff can attach a real email via
 *     Users → Edit later. Org-tied representatives with no matched email are
 *     unaffected by this — they still go through the Interim Admin Tool, per
 *     the "no reliable email to key a users row on" reasoning below.
 *   - upserts a bare `users` row (no organization) for any roster email
 *     that can't be attributed to any YAML organization at all (Step 3)
 *   - upserts `working_group_members` rows for every user created above,
 *     from the six per-WG roster CSVs, not the YAML `workingGroups:` field
 *     (Step 3b)
 *   - by default, also uploads every logo/photo found under
 *     `assets/images/members/<slug>/` to R2 (pass `--skip-logos` to opt out)
 *   - rewrites Hugo shortcodes (`{{< youtube ID >}}`, `{{< vimeo ID >}}`,
 *     `{{< video link="URL" ... >}}`) found in YAML `content` into plain
 *     URLs before writing `organizations.content_markdown`, so they render
 *     as links instead of literal, unresolved shortcode text
 *
 * What this script deliberately does NOT do:
 *   - create `organizations`/`users`/`members` rows for org-tied
 *     representatives with no domain-matched email at all — see the
 *     "unmatched" report section; these are finished one at a time via the
 *     Interim Admin Tool (`POST /api/v1/admin/members`). (Org-less
 *     individuals in the same situation *do* get a row now, via the
 *     sentinel-email path described above — the distinction is that an
 *     individual's own YAML file **is** their whole record, where an
 *     org-tied representative's record is meaningless without knowing which
 *     real person at the organization it belongs to.)
 *
 * Usage:
 *   node scripts/migrate-members-yaml-to-d1.mjs --local
 *   node scripts/migrate-members-yaml-to-d1.mjs --preview
 *   node scripts/migrate-members-yaml-to-d1.mjs --production
 *   node scripts/migrate-members-yaml-to-d1.mjs --local --dry-run   (writes SQL + report only)
 *
 * Environment flags mirror scripts/seed.mjs's ENVS table (binding is always
 * "DB"; --env/--local|--remote select which wrangler.jsonc environment
 * block resolves it):
 *   --local        --env local --local     (database pkic-db-local)
 *   --preview      --env preview --remote  (database pkic-db-preview)
 *   --production   --env production --remote (database pkic-db)
 *
 * Other flags:
 *   --persist-to <path>          forwarded to `wrangler d1 execute`
 *   --dry-run                    skip execution; only write the .sql + report
 *   --skip-logos                  don't upload logos/photos to R2 (on by default)
 *   --logo-bucket <name>          R2 bucket for logo uploads (default: pkic-assets)
 *   --out <dir>                    report output directory (default: ignore/)
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import YAML from "yaml";

const ROOT = process.cwd();
const MEMBERS_DIR = path.join(ROOT, "data", "members");
const CSV_DIR = path.join(ROOT, "csv");
const LOGO_DIR = path.join(ROOT, "assets", "images", "members");
const SPONSORS_YAML_PATH = path.join(ROOT, "data", "sponsors.yaml");
const SPONSOR_LOGO_DIR = path.join(ROOT, "assets", "images", "sponsors");

const WORKING_GROUP_CSVS = {
  ca: "ca.csv",
  cbom: "cbom.csv",
  cm: "cm.csv",
  pkimm: "pkimm.csv",
  pqc: "pqc.csv",
  tcwg: "tcwg.csv",
};
// csv/ec.csv (Executive Council roster) is intentionally excluded — EC
// membership is scope (users.is_ec_member), not this migration.

const INDIVIDUAL_CATEGORIES = new Set(["H5", "H6", "H7"]);

// (sponsorship reconciliation): maps a YAML `sponsor.sponsoring.<key>`
// event name to the `events` row it should attribute to. Only 3 distinct
// event names exist across all of data/members/*.yaml (checked 2026-07-29),
// small enough to hand-map from content/events/*/index.md front matter
// rather than fuzzy-match against event names — the single generic
// "Post-Quantum Cryptography Conference" row already seeded in D1 doesn't
// distinguish by city/year, so each of these becomes (or reuses, if already
// present by slug) its own `events` row.
const EVENT_NAME_ALIASES = {
  "Post-Quantum Cryptography Conference Amsterdam 2023": {
    slug: "pqc-conference-amsterdam-nl-2023",
    name: "Post-Quantum Cryptography Conference - Amsterdam 2023",
    timezone: "Europe/Amsterdam",
    startsAt: "2023-11-07",
    endsAt: "2023-11-08",
  },
  "Post-Quantum Cryptography Conference Austin 2025": {
    slug: "pqc-conference-austin-us-2025",
    name: "Post-Quantum Cryptography Conference - Austin 2025",
    timezone: "America/Chicago",
    startsAt: "2025-01-15",
    endsAt: "2025-01-16",
  },
  "Post-Quantum Cryptography Conference Kuala Lumpur 2025": {
    slug: "pqc-conference-kuala-lumpur-my-2025",
    name: "Post-Quantum Cryptography Conference - Kuala Lumpur 2025",
    timezone: "Asia/Kuala_Lumpur",
    startsAt: "2025-10-28",
    endsAt: "2025-10-30",
  },
};

// Matches scripts/seed.mjs's ENVS table — same three wrangler.jsonc
// environments, same binding ("DB") in every one of them.
const ENVS = {
  local: { wranglerFlag: "--local", wranglerEnv: "local" },
  preview: { wranglerFlag: "--remote", wranglerEnv: "preview" },
  production: { wranglerFlag: "--remote", wranglerEnv: "production" },
};

// ── CLI args ─────────────────────────────────────────────────────────────

// Matches wrangler.jsonc's per-environment R2 bucket names (`preview`'s
// `pkic-assets-preview` differs from `local`/`production`'s `pkic-assets`) —
// used as parseArgs's default so `--preview` without an explicit
// `--logo-bucket` doesn't silently upload photos into the production bucket.
const LOGO_BUCKET_BY_ENV = {
  local: "pkic-assets",
  preview: "pkic-assets-preview",
  production: "pkic-assets",
};

function parseArgs(argv) {
  const parsed = {
    env: null,
    database: "DB",
    persistTo: null,
    dryRun: false,
    uploadLogos: true,
    logoBucket: null,
    outDir: path.join(ROOT, "ignore"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--local") parsed.env = "local";
    else if (arg === "--preview") parsed.env = "preview";
    else if (arg === "--production" || arg === "--remote") parsed.env = "production";
    else if (arg === "--db" && next) {
      parsed.database = next;
      i += 1;
    } else if (arg === "--persist-to" && next) {
      parsed.persistTo = next;
      i += 1;
    } else if (arg === "--dry-run") parsed.dryRun = true;
    // --upload-logos is now the default; kept as an accepted no-op flag so
    // existing invocations (docs, muscle memory) don't break.
    else if (arg === "--upload-logos") parsed.uploadLogos = true;
    else if (arg === "--skip-logos") parsed.uploadLogos = false;
    else if (arg === "--logo-bucket" && next) {
      parsed.logoBucket = next;
      i += 1;
    } else if (arg === "--out" && next) {
      parsed.outDir = path.isAbsolute(next) ? next : path.join(ROOT, next);
      i += 1;
    }
  }

  if (!parsed.env && !parsed.dryRun) {
    console.error("Specify one of --local, --preview, --production (or use --dry-run alone to just inspect output).");
    process.exit(1);
  }
  parsed.env = parsed.env ?? "local";
  parsed.logoBucket = parsed.logoBucket ?? LOGO_BUCKET_BY_ENV[parsed.env];

  return parsed;
}

// ── SQL string helpers (matches scripts/seed-event.mjs conventions) ────────

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function toSqlNullableText(value) {
  if (value === null || value === undefined) return "NULL";
  const str = String(value).trim();
  return str.length === 0 ? "NULL" : sqlString(str);
}

// ── Small domain helpers ────────────────────────────────────────────────

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function normalizeOrgName(name) {
  // Matches functions/_lib/services/sponsorship.ts's normalizeOrgName —
  // this is the same upsert key convention (organizations.normalized_name).
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function emailDomain(email) {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

// `.invalid` is reserved by RFC 2606 as never resolvable/deliverable —
// matches the sentinel-email convention `user-merge.ts`'s `mergeUsers`
// already established for anonymized accounts (`merged-<id>@deleted.invalid`).
// Deterministic (keyed on the YAML slug, not a random id) so re-running the
// migration upserts the same placeholder row instead of creating a new one
// each time.
function sentinelEmailForSlug(slug) {
  return `unmatched-${slug}@members.invalid`;
}

/**
 * Rewrites Hugo shortcodes found in YAML `content` fields into plain URLs,
 * since `organizations.content_markdown` is rendered as Markdown, not Hugo
 * template syntax — a literal `{{< youtube ID >}}` would otherwise show up
 * as unresolved shortcode text on an organization's profile page instead of
 * a link. Only the three shortcodes actually present in data/members/*.yaml
 * are handled (checked 2026-07-28): `youtube`, `vimeo`, `video`.
 */
function convertHugoShortcodes(content) {
  if (!content) return content;
  return String(content)
    .replace(/\{\{<\s*youtube\s+([\w-]+)\s*>\}\}/gi, (_, id) => `https://www.youtube.com/watch?v=${id}`)
    .replace(/\{\{<\s*vimeo\s+(\d+)\s*>\}\}/gi, (_, id) => `https://vimeo.com/${id}`)
    .replace(/\{\{<\s*video\s+([^>]*)>\}\}/gi, (_, attrs) => {
      const match = attrs.match(/link\s*=\s*"([^"]+)"/);
      return match ? match[1] : "";
    });
}

function splitName(fullName) {
  const tokens = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: null, lastName: null };
  if (tokens.length === 1) return { firstName: tokens[0], lastName: null };
  return { firstName: tokens.slice(0, -1).join(" "), lastName: tokens[tokens.length - 1] };
}

// ── CSV parsing ──────────────────────────────────────────────────────────
// Each export has a non-CSV title line, then a real header line, then data
// rows. Nickname (column 2) is occasionally quoted with an embedded comma
// (e.g. "Dholakia, Sandip") — a tiny quote-aware splitter handles that.

function parseCsvLine(line) {
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
function loadRosterCsv(filePath) {
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

// ── YAML loading ─────────────────────────────────────────────────────────

function loadMemberYamlFiles() {
  const files = fs.readdirSync(MEMBERS_DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  return files.map((filename) => {
    const raw = fs.readFileSync(path.join(MEMBERS_DIR, filename), "utf8");
    const doc = YAML.parse(raw) ?? {};
    return { filename, slug: path.basename(filename, path.extname(filename)), doc };
  });
}

function activeRepresentatives(doc) {
  const reps = Array.isArray(doc.representatives) ? doc.representatives : [];
  // A rep with `till` set no longer represents the org
  // from/till convention) — excluded from user/member creation, but still
  // real historical content (attribution on blog posts etc.), so we leave
  // the YAML untouched; we just don't mint a portal account for them here.
  return reps.filter((r) => r && typeof r.name === "string" && r.name.trim().length > 0 && !r.till);
}

/** Full detail (not just a name) for a representative dropped from the
 * import — used in the report so staff completing them via the Interim
 * Admin Tool don't have to re-derive LinkedIn/role/bio from the YAML. */
function repSummary(r) {
  return {
    name: r.name,
    role: r.role ?? null,
    linkedin: r.social?.linkedin || null,
    bio: r.description ?? null,
  };
}

function findLogoFile(slug) {
  const dir = path.join(LOGO_DIR, slug);
  if (!fs.existsSync(dir)) return null;
  const candidates = fs.readdirSync(dir).filter((f) => /\.(svg|png|jpg|jpeg)$/i.test(f));
  // Require an exact `<slug>.<ext>` match. Falling back to "the first file
  // in the directory" when no exact match exists previously risked silently
  // picking an unrelated file (e.g. a representative's headshot living in
  // the same directory) as the organization logo.
  const exact = candidates.find((f) => path.basename(f, path.extname(f)) === slug);
  return exact ? path.join(dir, exact) : null;
}

/** Mirrors Hugo's `urlize`: lowercase, strip diacritics, non-alphanumerics -> hyphens. */
function urlizeName(name) {
  return String(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining diacritical marks left behind by NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Short tokens (van, der, von, de, la, ...) are dropped before name/email
// matching — they're common enough across unrelated candidates in the same
// org that counting them as a match produces false positives more often
// than real signal.
const NAME_MATCH_MIN_TOKEN_LENGTH = 4;

function nameTokens(fullName) {
  return String(fullName)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= NAME_MATCH_MIN_TOKEN_LENGTH);
}

function emailLocalAlnum(email) {
  const at = String(email).lastIndexOf("@");
  const local = at === -1 ? String(email) : String(email).slice(0, at);
  return local
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Pairs YAML `representatives[]` entries with domain-matched roster emails
 * by name, instead of blindly zipping listed order against join-date order
 * (which silently attaches one representative's bio/role to a different
 * person's email whenever the YAML list order and the roster join order
 * don't happen to match.
 *
 * Each representative's name tokens are checked as substrings of each
 * candidate email's local part; confident matches (score > 0) are assigned
 * greedily, highest-scoring first. Anything a name match can't resolve
 * falls back to the original join-order positional pairing, same
 * "best effort, flagged for staff confirmation" behavior as before this
 * matched on names at all.
 *
 * Returns an array parallel to `reps`: the matched candidate's index into
 * `candidates`, or null if every candidate is already claimed.
 */
function matchRepsToCandidates(reps, candidates) {
  const repTokens = reps.map((r) => nameTokens(r.name));
  const candidateLocals = candidates.map((c) => emailLocalAlnum(c.email));

  const scored = [];
  for (let ri = 0; ri < reps.length; ri += 1) {
    for (let ci = 0; ci < candidates.length; ci += 1) {
      const score = repTokens[ri].reduce((n, token) => n + (candidateLocals[ci].includes(token) ? 1 : 0), 0);
      if (score > 0) scored.push({ ri, ci, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  const assignment = new Array(reps.length).fill(null);
  const usedCandidates = new Set();
  for (const { ri, ci } of scored) {
    if (assignment[ri] !== null || usedCandidates.has(ci)) continue;
    assignment[ri] = ci;
    usedCandidates.add(ci);
  }

  let nextCandidate = 0;
  for (let ri = 0; ri < reps.length; ri += 1) {
    if (assignment[ri] !== null) continue;
    while (nextCandidate < candidates.length && usedCandidates.has(nextCandidate)) nextCandidate += 1;
    if (nextCandidate >= candidates.length) continue;
    assignment[ri] = nextCandidate;
    usedCandidates.add(nextCandidate);
    nextCandidate += 1;
  }

  return assignment;
}

/**
 * Per-representative photo, sourced from the same `assets/images/members/<orgSlug>/`
 * directory as the org logo — the old Hugo `single.html` looked these up at
 * `/images/members/<orgSlug>/<repId-or-urlized-name>.*` (falling back to the
 * urlized representative name when no explicit `id` was set on the YAML
 * `representatives[]` entry). Distinct from `findLogoFile`, which only ever
 * matches the org's own `<orgSlug>.*` file.
 */
function findRepPhotoFile(orgSlug, rep) {
  const dir = path.join(LOGO_DIR, orgSlug);
  if (!fs.existsSync(dir)) return null;
  const repSlug = String(rep.id ?? urlizeName(rep.name));
  if (!repSlug) return null;
  const candidates = fs.readdirSync(dir).filter((f) => /\.(svg|png|jpg|jpeg)$/i.test(f));
  const exact = candidates.find((f) => path.basename(f, path.extname(f)) === repSlug);
  return exact ? path.join(dir, exact) : null;
}

// ── Reconciliation ───────────────────────────────────────────────────────

function buildEmailsByDomain(pkicRoster) {
  const byDomain = new Map();
  for (const [email, meta] of pkicRoster.entries()) {
    const domain = emailDomain(email);
    if (!domain) continue;
    const list = byDomain.get(domain) ?? [];
    list.push({ email, joinSortKey: meta.joinSortKey });
    byDomain.set(domain, list);
  }
  for (const list of byDomain.values()) {
    list.sort((a, b) => a.joinSortKey.localeCompare(b.joinSortKey));
  }
  return byDomain;
}

function candidateEmailsForDomains(domains, emailsByDomain) {
  const seen = new Set();
  const candidates = [];
  for (const domain of domains) {
    const list = emailsByDomain.get(String(domain).trim().toLowerCase()) ?? [];
    for (const entry of list) {
      if (seen.has(entry.email)) continue;
      seen.add(entry.email);
      candidates.push(entry);
    }
  }
  candidates.sort((a, b) => a.joinSortKey.localeCompare(b.joinSortKey));
  return candidates;
}

/**
 * Builds the full set of SQL statements plus a structured report, per the
 * reconciliation algorithm.
 */
function buildMigration({ uploadLogos }) {
  const yamlRecords = loadMemberYamlFiles();
  const pkicRoster = loadRosterCsv(path.join(CSV_DIR, "pkic.csv"));

  const wgRosters = {};
  for (const [slug, filename] of Object.entries(WORKING_GROUP_CSVS)) {
    wgRosters[slug] = loadRosterCsv(path.join(CSV_DIR, filename));
  }

  // Domain-based org matching (Step 2 representative pairing, and the
  // "leftover matched candidates become anonymous org members" fallback
  // just below it) draws candidates from every roster we have, not just
  // pkic.csv — a representative or subscriber can appear only on a
  // working-group list (e.g. csv/ca.csv) and never on the main pkic@ list,
  // but their email still domain-matches their organization's
  // `organizationDomains` and should be attributed to it instead of
  // silently ending up an org-less bare/WG-only user.
  const combinedRoster = new Map(pkicRoster);
  for (const roster of Object.values(wgRosters)) {
    for (const [email, meta] of roster.entries()) {
      if (!combinedRoster.has(email)) combinedRoster.set(email, meta);
    }
  }
  const emailsByDomain = buildEmailsByDomain(combinedRoster);

  const statements = [];
  const logoUploads = []; // { slug, filePath, r2Key }
  const claimedEmails = new Set();
  const createdUserEmails = new Set(); // every email we insert a `users` row for
  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      yamlFiles: yamlRecords.length,
      matchedOrgs: 0,
      sentinelIndividuals: 0,
      unmatched: [],
      missingCategory: [],
      ambiguousPairing: [],
    },
    needsEmailIndividuals: [],
    bareRosterUsers: [],
    wgOnlyRosterUsers: [],
    unmatchedEventSponsorships: [],
    nonMemberSponsorships: { created: 0, unmatchedEvents: [] },
    workingGroupCounts: Object.fromEntries(Object.keys(WORKING_GROUP_CSVS).map((k) => [k, 0])),
  };

  statements.push("PRAGMA foreign_keys = ON;");

  function upsertOrganization({ slug, name, doc, logoR2Key, membershipCategory }) {
    const normalizedName = normalizeOrgName(name);
    const social = doc.social ?? {};
    const blog = doc.blog ?? {};
    const press = doc.press ?? {};
    const careers = doc.careers ?? {};
    const contentMarkdown = convertHugoShortcodes(doc.content);
    // YAML `id:` (e.g. `id: keyfactor`) backs the clean public URL slug
    // (`/members/<slug>`) — falls back to the filename-derived slug for the
    // (currently nonexistent) case of a file with no `id:` key at all.
    const urlSlug = String(doc.id ?? slug).trim() || slug;

    statements.push(`
INSERT INTO organizations (
  id, name, normalized_name, data_json, slug, membership_category,
  description, website, content_markdown, slogan, logo_r2_key, member_since,
  blog_url, blog_feed_url, press_url, press_feed_url, careers_url,
  social_x, social_linkedin, social_facebook, social_instagram, social_youtube,
  created_at, updated_at
) VALUES (
  ${sqlString(randomUUID())}, ${sqlString(name)}, ${sqlString(normalizedName)}, NULL, ${toSqlNullableText(urlSlug)}, ${toSqlNullableText(membershipCategory)},
  ${toSqlNullableText(doc.description)}, ${toSqlNullableText(doc.website)}, ${toSqlNullableText(contentMarkdown)}, ${toSqlNullableText(doc.slogan)}, ${toSqlNullableText(logoR2Key)}, ${toSqlNullableText(doc.memberSince)},
  ${toSqlNullableText(blog.url)}, ${toSqlNullableText(blog.feed)}, ${toSqlNullableText(press.url)}, ${toSqlNullableText(press.feed)}, ${toSqlNullableText(careers.url)},
  ${toSqlNullableText(social.x)}, ${toSqlNullableText(social.linkedin)}, ${toSqlNullableText(social.facebook)}, ${toSqlNullableText(social.instagram)}, ${toSqlNullableText(social.youtube)},
  datetime('now'), datetime('now')
)
ON CONFLICT(normalized_name) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  website = excluded.website,
  content_markdown = excluded.content_markdown,
  slogan = excluded.slogan,
  logo_r2_key = COALESCE(excluded.logo_r2_key, organizations.logo_r2_key),
  member_since = COALESCE(organizations.member_since, excluded.member_since),
  -- Never clobber a slug or category staff may have hand-set via the admin
  -- UI after the initial migration — only fill when still unset.
  slug = COALESCE(organizations.slug, excluded.slug),
  membership_category = COALESCE(organizations.membership_category, excluded.membership_category),
  blog_url = excluded.blog_url,
  blog_feed_url = excluded.blog_feed_url,
  press_url = excluded.press_url,
  press_feed_url = excluded.press_feed_url,
  careers_url = excluded.careers_url,
  social_x = excluded.social_x,
  social_linkedin = excluded.social_linkedin,
  social_facebook = excluded.social_facebook,
  social_instagram = excluded.social_instagram,
  social_youtube = excluded.social_youtube,
  updated_at = datetime('now');
`);

    return normalizedName;
  }

  function upsertUser({ email, firstName, lastName, jobTitle, biography, linksJson, headshotR2Key }) {
    const normalized = normalizeEmail(email);
    createdUserEmails.add(normalized);
    statements.push(`
INSERT INTO users (
  id, email, normalized_email, first_name, last_name, job_title, biography, links_json,
  headshot_r2_key, role, active, created_at, updated_at
) VALUES (
  ${sqlString(randomUUID())}, ${sqlString(email)}, ${sqlString(normalized)},
  ${toSqlNullableText(firstName)}, ${toSqlNullableText(lastName)}, ${toSqlNullableText(jobTitle)},
  ${toSqlNullableText(biography)}, ${linksJson ? sqlString(linksJson) : "NULL"},
  ${toSqlNullableText(headshotR2Key)},
  'user', 1, datetime('now'), datetime('now')
)
ON CONFLICT(normalized_email) DO UPDATE SET
  first_name = COALESCE(users.first_name, excluded.first_name),
  last_name = COALESCE(users.last_name, excluded.last_name),
  job_title = COALESCE(users.job_title, excluded.job_title),
  biography = COALESCE(users.biography, excluded.biography),
  links_json = COALESCE(users.links_json, excluded.links_json),
  -- 'headshots/...' keys are hand-uploaded via the admin self-service headshot
  -- endpoint (SPEAKER_UPLOADS_BUCKET) and must never be clobbered by a rerun.
  -- Anything else (NULL, or a previous 'member-photos/...' migration key) is
  -- fair game so a corrected/updated YAML photo actually takes effect on rerun.
  headshot_r2_key = CASE
    WHEN users.headshot_r2_key LIKE 'headshots/%' THEN users.headshot_r2_key
    ELSE COALESCE(excluded.headshot_r2_key, users.headshot_r2_key)
  END,
  updated_at = datetime('now');
`);
    return normalized;
  }

  function insertMemberIfAbsent({ normalizedEmail, normalizedOrgName, memberType, showOnOrgProfile, memberSince }) {
    const orgIdExpr = normalizedOrgName
      ? `(SELECT id FROM organizations WHERE normalized_name = ${sqlString(normalizedOrgName)})`
      : "NULL";
    statements.push(`
INSERT OR IGNORE INTO members (
  id, member_type, user_id, organization_id, status, tier, data_json, created_at, updated_at, show_on_org_profile, member_since
) VALUES (
  ${sqlString(randomUUID())}, ${sqlString(memberType || "UNKNOWN")},
  (SELECT id FROM users WHERE normalized_email = ${sqlString(normalizedEmail)}),
  ${orgIdExpr}, 'active', NULL, NULL, datetime('now'), datetime('now'), ${showOnOrgProfile ? 1 : 0}, ${toSqlNullableText(memberSince)}
);
`);
  }

  function setContactIfUnset(column, normalizedOrgName, normalizedEmail) {
    statements.push(`
UPDATE organizations SET ${column} = (SELECT id FROM users WHERE normalized_email = ${sqlString(normalizedEmail)}), updated_at = datetime('now')
WHERE normalized_name = ${sqlString(normalizedOrgName)} AND ${column} IS NULL;
`);
  }

  // ── Step 3e: sponsorship reconciliation (data/members/*.yaml `sponsor:`) ──
  // Previously deliberately skipped by this script (see file header); now
  // migrates both the consortium-wide tier and any per-event sponsorships.
  // Guarded by NOT EXISTS instead of an ON CONFLICT target (sponsorships has
  // no natural unique key for "this org's consortium sponsorship" / "this
  // org's sponsorship of this event") so re-running the migration doesn't
  // duplicate rows, but also doesn't clobber a tier staff later changed by
  // hand via the admin Sponsorships screen.
  function upsertSponsorships({ normalizedOrgName, doc, filename, name, report }) {
    const sponsor = doc.sponsor;
    if (!sponsor) return;

    const level = String(sponsor.level ?? "").trim();
    if (level) {
      const startDate = sponsor.since ?? doc.memberSince ?? null;
      statements.push(`
INSERT INTO sponsorships (id, sponsor_type, organization_id, tier, pipeline_stage, start_date, created_at, updated_at)
SELECT ${sqlString(randomUUID())}, 'consortium', o.id, ${sqlString(level)}, 'active', ${toSqlNullableText(startDate)}, datetime('now'), datetime('now')
FROM organizations o
WHERE o.normalized_name = ${sqlString(normalizedOrgName)}
  AND NOT EXISTS (SELECT 1 FROM sponsorships s WHERE s.organization_id = o.id AND s.sponsor_type = 'consortium');
`);
      statements.push(`
UPDATE organizations
SET sponsor_tier = COALESCE(sponsor_tier, ${sqlString(level)}),
    sponsor_start_date = COALESCE(sponsor_start_date, ${toSqlNullableText(startDate)}),
    updated_at = datetime('now')
WHERE normalized_name = ${sqlString(normalizedOrgName)};
`);
    }

    const sponsoring = sponsor.sponsoring;
    if (sponsoring && typeof sponsoring === "object") {
      for (const [eventName, eventSponsor] of Object.entries(sponsoring)) {
        const tier = String(eventSponsor?.level ?? "").trim();
        if (!tier) continue;
        const alias = EVENT_NAME_ALIASES[eventName];
        if (!alias) {
          report.unmatchedEventSponsorships.push({ file: filename, name, eventName, tier });
          continue;
        }
        statements.push(`
INSERT INTO events (id, slug, name, timezone, starts_at, ends_at, created_at, updated_at)
VALUES (${sqlString(randomUUID())}, ${sqlString(alias.slug)}, ${sqlString(alias.name)}, ${sqlString(alias.timezone)}, ${toSqlNullableText(alias.startsAt)}, ${toSqlNullableText(alias.endsAt)}, datetime('now'), datetime('now'))
ON CONFLICT(slug) DO NOTHING;
`);
        statements.push(`
INSERT INTO sponsorships (id, sponsor_type, organization_id, event_id, tier, pipeline_stage, created_at, updated_at)
SELECT ${sqlString(randomUUID())}, 'event', o.id, e.id, ${sqlString(tier)}, 'active', datetime('now'), datetime('now')
FROM organizations o, events e
WHERE o.normalized_name = ${sqlString(normalizedOrgName)}
  AND e.slug = ${sqlString(alias.slug)}
  AND NOT EXISTS (
    SELECT 1 FROM sponsorships s WHERE s.organization_id = o.id AND s.sponsor_type = 'event' AND s.event_id = e.id
  );
`);
      }
    }
  }

  // ── Step 2: organizations + representatives ─────────────────────────────

  for (const { filename, slug, doc } of yamlRecords) {
    const name = String(doc.name ?? slug).trim();
    const memberType = String(doc.memberType ?? "").trim();
    const isIndividual = INDIVIDUAL_CATEGORIES.has(memberType);
    const domains = Array.isArray(doc.organizationDomains) ? doc.organizationDomains.filter(Boolean) : [];
    const reps = activeRepresentatives(doc);
    const candidates = candidateEmailsForDomains(domains, emailsByDomain);

    if (!memberType) {
      report.totals.missingCategory.push({ file: filename, name });
    }

    if (isIndividual) {
      // Individuals have no organization row at all.
      //
      // Unlike org-tied representatives (where an unmatched email means "we
      // don't know which real person this is" and the row is left for the
      // Interim Admin Tool), an org-less individual's YAML file *is* their
      // whole record — every field needed to create them is already known
      // except a deliverable email. So an individual with no domain-matched
      // roster email still gets a real row, keyed on a deterministic
      // sentinel `.invalid` placeholder email (see sentinelEmailForSlug),
      // flagged `needsEmail: true` for staff to attach a real address later.
      const needsEmail = candidates.length === 0;
      const email = needsEmail ? sentinelEmailForSlug(slug) : candidates[0].email;

      if (needsEmail) {
        report.needsEmailIndividuals.push({
          file: filename,
          name,
          memberType,
          sentinelEmail: email,
          reason: domains.length ? "no roster subscriber at this domain" : "no domain to match against",
          workingGroupsHint: doc.workingGroups ?? [],
        });
      }

      // Individuals use the same per-slug image directory as org logos
      // (`/images/members/<slug>/<slug>.*`, per the old Hugo member-card/
      // single-page partials) — there's no separate `organizations` row to
      // hold a key for it, so it's stored on the user's own `headshot_r2_key`
      // (the same column self-service headshot uploads use).
      let headshotR2Key = null;
      if (uploadLogos) {
        const photoFile = findLogoFile(slug);
        if (photoFile) {
          headshotR2Key = `member-photos/${slug}/${path.basename(photoFile)}`;
          logoUploads.push({ slug, filePath: photoFile, r2Key: headshotR2Key });
        }
      }

      const rep = reps[0] ?? { name, role: null, social: {}, description: null };
      const { firstName, lastName } = splitName(rep.name ?? name);
      // Canonical persisted shape is a plain URL array (matches
      // assets/shared/schemas/api.ts's linksSchema and everything
      // users.links_json is written/read as elsewhere) — not the legacy
      // {linkedin, x} object this script used to write.
      const links = [rep.social?.linkedin, rep.social?.x].filter(Boolean);
      const normalizedEmail = upsertUser({
        email,
        firstName,
        lastName,
        jobTitle: rep.role ?? null,
        biography: rep.description ?? null,
        linksJson: links.length > 0 ? JSON.stringify(links) : null,
        headshotR2Key,
      });
      claimedEmails.add(normalizedEmail);
      insertMemberIfAbsent({
        normalizedEmail,
        normalizedOrgName: null,
        memberType,
        showOnOrgProfile: true,
        memberSince: doc.memberSince,
      });
      if (needsEmail) report.totals.sentinelIndividuals += 1;
      else report.totals.matchedOrgs += 1;
      continue;
    }

    // Org-tied (A-G, H1-H4, H8): organization row is always created,
    // matched or not.
    let logoR2Key = null;
    if (uploadLogos) {
      const logoFile = findLogoFile(slug);
      if (logoFile) {
        logoR2Key = `org-logos/${slug}/${path.basename(logoFile)}`;
        logoUploads.push({ slug, filePath: logoFile, r2Key: logoR2Key });
      }
    }
    const normalizedOrgName = upsertOrganization({ slug, name, doc, logoR2Key, membershipCategory: memberType });
    upsertSponsorships({ normalizedOrgName, doc, filename, name, report });

    if (candidates.length === 0) {
      report.totals.unmatched.push({
        file: filename,
        name,
        memberType,
        representatives: reps.map(repSummary),
        reason: domains.length ? "no roster subscriber at this domain" : "no domain to match against",
        workingGroupsHint: doc.workingGroups ?? [],
      });
      continue;
    }

    const assignment = matchRepsToCandidates(reps, candidates); // parallel to reps: candidate index or null
    const unpairedReps = reps.filter((_, i) => assignment[i] === null);

    if (reps.length > 1 && candidates.length > 1) {
      report.totals.ambiguousPairing.push({
        file: filename,
        name,
        representatives: reps.map((r) => r.name),
        candidateEmails: candidates.map((c) => c.email),
      });
    }
    if (unpairedReps.length > 0) {
      report.totals.ambiguousPairing.push({
        file: filename,
        name,
        note: "more named representatives than matched emails — some representatives got no portal account",
        // Full detail (not just names), so staff finishing these via the
        // Interim Admin Tool have LinkedIn/role/bio in hand without going
        // back to the YAML — this data was previously dropped silently.
        unpaired: unpairedReps.map(repSummary),
      });
    }

    const contactEmails = [];
    const matchedCandidateIndices = new Set();

    for (let i = 0; i < reps.length; i += 1) {
      if (assignment[i] === null) continue;
      const rep = reps[i];
      const { email } = candidates[assignment[i]];
      matchedCandidateIndices.add(assignment[i]);
      const { firstName, lastName } = splitName(rep.name);
      // Canonical persisted shape is a plain URL array (matches
      // assets/shared/schemas/api.ts's linksSchema and everything
      // users.links_json is written/read as elsewhere) — not the legacy
      // {linkedin, x} object this script used to write.
      const links = [rep.social?.linkedin, rep.social?.x].filter(Boolean);

      // Representative photos live in the same `assets/images/members/<orgSlug>/`
      // directory as the org logo, one file per person (see findRepPhotoFile) —
      // distinct from the org's own `<orgSlug>.*` logo file.
      let repHeadshotR2Key = null;
      if (uploadLogos) {
        const photoFile = findRepPhotoFile(slug, rep);
        if (photoFile) {
          repHeadshotR2Key = `member-photos/${slug}/${path.basename(photoFile)}`;
          logoUploads.push({ slug, filePath: photoFile, r2Key: repHeadshotR2Key });
        }
      }

      const normalizedEmail = upsertUser({
        email,
        firstName,
        lastName,
        jobTitle: rep.role ?? null,
        biography: rep.description ?? null,
        linksJson: links.length > 0 ? JSON.stringify(links) : null,
        headshotR2Key: repHeadshotR2Key,
      });
      claimedEmails.add(normalizedEmail);
      insertMemberIfAbsent({
        normalizedEmail,
        normalizedOrgName,
        memberType,
        showOnOrgProfile: true,
        memberSince: doc.memberSince,
      });
      contactEmails.push(normalizedEmail);
    }

    // Domain-matched emails not paired to any named representative (or,
    // for orgs with no `representatives` field at all, every matched
    // email) become anonymous, opted-out member rows..
    for (let i = 0; i < candidates.length; i += 1) {
      if (matchedCandidateIndices.has(i)) continue;
      const { email } = candidates[i];
      const normalizedEmail = upsertUser({
        email,
        firstName: null,
        lastName: null,
        jobTitle: null,
        biography: null,
        linksJson: null,
      });
      claimedEmails.add(normalizedEmail);
      insertMemberIfAbsent({
        normalizedEmail,
        normalizedOrgName,
        memberType,
        showOnOrgProfile: false,
        memberSince: doc.memberSince,
      });
      contactEmails.push(normalizedEmail);
    }

    if (contactEmails[0]) setContactIfUnset("primary_contact_user_id", normalizedOrgName, contactEmails[0]);
    if (contactEmails[1]) setContactIfUnset("secondary_contact_user_id", normalizedOrgName, contactEmails[1]);

    report.totals.matchedOrgs += 1;
  }

  // ── Step 3: bare users for roster emails not attributable to any org ────

  // For every email that couldn't be reconciled to a YAML representative,
  // record which working-group roster CSV(s) it appears in — this is exactly
  // the manual-reconciliation signal staff need (an email with no name/org
  // attached, but a known set of WGs it belongs to) and previously wasn't
  // captured anywhere.
  function wgSlugsForEmail(email) {
    return Object.entries(wgRosters)
      .filter(([, roster]) => roster.has(email))
      .map(([slug]) => slug);
  }

  for (const [email] of pkicRoster.entries()) {
    if (claimedEmails.has(email)) continue;
    upsertUser({ email, firstName: null, lastName: null, jobTitle: null, biography: null, linksJson: null });
    report.bareRosterUsers.push({ email, workingGroups: wgSlugsForEmail(email) });
  }

  // Finding (this migration, not in the original): a meaningful
  // number of WG-roster subscribers never appear in csv/pkic.csv at all
  // (288 across the six WG CSVs in a 2026-07-26 dry run) — e.g. someone
  // unsubscribed from the main pkic@ list but stayed on a WG list, or the
  // exports were taken at slightly different times. This
  // only covers "CSV roster emails not attributable to any YAML
  // organization" sourced from pkic.csv, which would silently drop these
  // people's WG membership entirely (can only attach
  // working_group_members to a user row that already exists). We create a
  // bare user for them too, flagged separately in the report,
  // below has a user row to attach their WG membership to.
  for (const roster of Object.values(wgRosters)) {
    for (const [email] of roster.entries()) {
      if (claimedEmails.has(email) || createdUserEmails.has(email)) continue;
      upsertUser({ email, firstName: null, lastName: null, jobTitle: null, biography: null, linksJson: null });
      report.wgOnlyRosterUsers.push({ email, workingGroups: wgSlugsForEmail(email) });
    }
  }

  // ── Step 3b: working_group_members from the per-WG roster CSVs ─────────

  const wgIdExpr = (slug) => `(SELECT id FROM working_groups WHERE slug = ${sqlString(slug)})`;

  for (const [wgSlug, roster] of Object.entries(wgRosters)) {
    for (const [email, meta] of roster.entries()) {
      if (!createdUserEmails.has(email)) continue; // not a user we created (shouldn't happen, defensive)
      report.workingGroupCounts[wgSlug] += 1;

      const joinedAt = "datetime('now')"; // roster export has no real calendar date, only join-order fields
      void meta;
      statements.push(`
INSERT INTO working_group_members (id, working_group_id, user_id, joined_at, left_at)
SELECT ${sqlString(randomUUID())}, ${wgIdExpr(wgSlug)}, (SELECT id FROM users WHERE normalized_email = ${sqlString(email)}), ${joinedAt}, NULL
WHERE (SELECT id FROM users WHERE normalized_email = ${sqlString(email)}) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM working_group_members wgm
    WHERE wgm.working_group_id = ${wgIdExpr(wgSlug)}
      AND wgm.user_id = (SELECT id FROM users WHERE normalized_email = ${sqlString(email)})
      AND wgm.left_at IS NULL
  );
`);
    }
  }

  // ── non-member sponsors (data/sponsors.yaml) ───────────────────
  // The one-time 2026-07-29 backfill only covered data/members/*.yaml's
  // `sponsor:` block (Step 3e above) — data/sponsors.yaml (companies that
  // sponsor without being a PKIC member, e.g. an event venue partner) was
  // never migrated, meaning those sponsors silently vanished the moment the
  // public sponsor display cut over to reading D1 (
  // "re-run/diff the backfill immediately before cutover").
  // Same NOT EXISTS-guarded, re-run-safe shape, just without an
  // organization_id (non_member_name identifies the sponsor instead).
  if (fs.existsSync(SPONSORS_YAML_PATH)) {
    const nonMemberSponsors = YAML.parse(fs.readFileSync(SPONSORS_YAML_PATH, "utf8")) ?? [];
    for (const entry of nonMemberSponsors) {
      const sponsorName = String(entry.name ?? "").trim();
      if (!sponsorName) continue;
      const website = entry.website ?? null;
      const sponsorSlug = urlizeName(sponsorName);

      let logoR2Key = null;
      if (uploadLogos && entry.logo) {
        const logoFile = path.join(SPONSOR_LOGO_DIR, entry.logo);
        if (fs.existsSync(logoFile)) {
          logoR2Key = `sponsor-logos/${sponsorSlug}/${path.basename(logoFile)}`;
          logoUploads.push({ slug: sponsorSlug, filePath: logoFile, r2Key: logoR2Key });
        }
      }

      const sponsor = entry.sponsor ?? {};
      const level = String(sponsor.level ?? "").trim();
      if (level) {
        statements.push(`
INSERT INTO sponsorships (id, sponsor_type, non_member_name, non_member_website, non_member_logo_r2_key, tier, pipeline_stage, created_at, updated_at)
SELECT ${sqlString(randomUUID())}, 'consortium', ${sqlString(sponsorName)}, ${toSqlNullableText(website)}, ${toSqlNullableText(logoR2Key)}, ${sqlString(level)}, 'active', datetime('now'), datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM sponsorships WHERE sponsor_type = 'consortium' AND organization_id IS NULL AND non_member_name = ${sqlString(sponsorName)}
);
`);
        report.nonMemberSponsorships.created += 1;
      }

      const sponsoring = sponsor.sponsoring;
      if (sponsoring && typeof sponsoring === "object") {
        for (const [eventName, eventSponsor] of Object.entries(sponsoring)) {
          const tier = String(eventSponsor?.level ?? "").trim();
          if (!tier) continue;
          const alias = EVENT_NAME_ALIASES[eventName];
          if (!alias) {
            report.nonMemberSponsorships.unmatchedEvents.push({ name: sponsorName, eventName, tier });
            continue;
          }
          statements.push(`
INSERT INTO events (id, slug, name, timezone, starts_at, ends_at, created_at, updated_at)
VALUES (${sqlString(randomUUID())}, ${sqlString(alias.slug)}, ${sqlString(alias.name)}, ${sqlString(alias.timezone)}, ${toSqlNullableText(alias.startsAt)}, ${toSqlNullableText(alias.endsAt)}, datetime('now'), datetime('now'))
ON CONFLICT(slug) DO NOTHING;
`);
          statements.push(`
INSERT INTO sponsorships (id, sponsor_type, non_member_name, non_member_website, non_member_logo_r2_key, event_id, tier, pipeline_stage, created_at, updated_at)
SELECT ${sqlString(randomUUID())}, 'event', ${sqlString(sponsorName)}, ${toSqlNullableText(website)}, ${toSqlNullableText(logoR2Key)}, e.id, ${sqlString(tier)}, 'active', datetime('now'), datetime('now')
FROM events e
WHERE e.slug = ${sqlString(alias.slug)}
  AND NOT EXISTS (
    SELECT 1 FROM sponsorships s
    WHERE s.sponsor_type = 'event' AND s.organization_id IS NULL AND s.non_member_name = ${sqlString(sponsorName)} AND s.event_id = e.id
  );
`);
          report.nonMemberSponsorships.created += 1;
        }
      }
    }
  }

  return { sql: statements.join("\n"), report, logoUploads };
}

// ── Report rendering ─────────────────────────────────────────────────────

function formatRep(rep) {
  const bits = [];
  if (rep.role) bits.push(rep.role);
  if (rep.linkedin) bits.push(rep.linkedin);
  return bits.length ? `${rep.name} (${bits.join(", ")})` : rep.name;
}

function renderMarkdownReport(report) {
  const lines = [];
  lines.push(`# Member migration report (${report.generatedAt})`);
  lines.push("");
  lines.push(`- YAML files processed: ${report.totals.yamlFiles}`);
  lines.push(`- Organizations/individuals with at least one domain-matched email: ${report.totals.matchedOrgs}`);
  lines.push(
    `- Org-less individuals created with a placeholder email (needs a real email attached via Users → Edit): ${report.totals.sentinelIndividuals}`,
  );
  lines.push(
    `- Unmatched org-tied representatives (no domain match at all — needs the Interim Admin Tool): ${report.totals.unmatched.length}`,
  );
  lines.push(`- Bare roster users (no attributable YAML org): ${report.bareRosterUsers.length}`);
  lines.push(
    `- WG-only roster users (subscribed to a WG list but absent from pkic.csv): ${report.wgOnlyRosterUsers.length}`,
  );
  lines.push(`- Missing membership category (\`memberType\` blank in YAML): ${report.totals.missingCategory.length}`);
  lines.push(
    `- Ambiguous representative/email pairing (needs staff confirmation): ${report.totals.ambiguousPairing.length}`,
  );
  lines.push(
    `- Event sponsorships with an unrecognized event name (needs an EVENT_NAME_ALIASES entry): ${report.unmatchedEventSponsorships.length}`,
  );
  lines.push(
    `- Non-member sponsorships created from data/sponsors.yaml (consortium + event rows): ${report.nonMemberSponsorships.created}`,
  );
  lines.push("");
  lines.push("## Working group roster membership counts");
  for (const [slug, count] of Object.entries(report.workingGroupCounts)) {
    lines.push(`- ${slug}: ${count}`);
  }
  lines.push("");
  lines.push("## Unmatched — finish via `POST /api/v1/admin/members` (Interim Admin Tool)");
  for (const item of report.totals.unmatched) {
    lines.push(
      `- **${item.name}** (\`${item.file}\`, category ${item.memberType || "unknown"}) — ${item.reason}. Representatives: ${item.representatives.map(formatRep).join("; ") || "(none listed)"}${item.workingGroupsHint?.length ? `. WG hint: ${item.workingGroupsHint.join(", ")}` : ""}`,
    );
  }
  lines.push("");
  lines.push(
    "## Org-less individuals created with a placeholder email — attach a real email via Users → Edit",
  );
  for (const item of report.needsEmailIndividuals) {
    lines.push(
      `- **${item.name}** (\`${item.file}\`, category ${item.memberType || "unknown"}) — created as \`${item.sentinelEmail}\`. ${item.reason}${item.workingGroupsHint?.length ? `. WG hint: ${item.workingGroupsHint.join(", ")}` : ""}`,
    );
  }
  lines.push("");
  lines.push("## Missing membership category — staff must set before launch");
  for (const item of report.totals.missingCategory) {
    lines.push(`- ${item.name} (\`${item.file}\`)`);
  }
  lines.push("");
  lines.push("## Ambiguous pairing — confirm representative ↔ email assignment");
  for (const item of report.totals.ambiguousPairing) {
    if (item.note) {
      lines.push(`- **${item.name}** (\`${item.file}\`) — ${item.note}: ${item.unpaired.map(formatRep).join("; ")}`);
    } else {
      lines.push(
        `- **${item.name}** (\`${item.file}\`) — representatives [${item.representatives.join(", ")}] paired best-effort (listed order) against emails [${item.candidateEmails.join(", ")}]`,
      );
    }
  }
  lines.push("");
  lines.push(
    "## Bare roster users (no YAML organization match) — working groups shown are where staff can look to reconcile identity manually",
  );
  for (const { email, workingGroups } of report.bareRosterUsers) {
    lines.push(`- ${email}${workingGroups.length ? ` — WGs: ${workingGroups.join(", ")}` : " — no WG membership"}`);
  }
  lines.push("");
  lines.push("## WG-only roster users (not in pkic.csv at all)");
  for (const { email, workingGroups } of report.wgOnlyRosterUsers) {
    lines.push(`- ${email}${workingGroups.length ? ` — WGs: ${workingGroups.join(", ")}` : ""}`);
  }
  lines.push("");
  lines.push(
    "## Event sponsorships with an unrecognized event name — add an EVENT_NAME_ALIASES entry in the script",
  );
  for (const item of report.unmatchedEventSponsorships) {
    lines.push(`- **${item.name}** (\`${item.file}\`) — \`${item.eventName}\` (tier ${item.tier})`);
  }
  lines.push("");
  lines.push(
    "## Non-member event sponsorships with an unrecognized event name (data/sponsors.yaml) — add an EVENT_NAME_ALIASES entry",
  );
  for (const item of report.nonMemberSponsorships.unmatchedEvents) {
    lines.push(`- **${item.name}** — \`${item.eventName}\` (tier ${item.tier})`);
  }
  return lines.join("\n");
}

// ── Execution ────────────────────────────────────────────────────────────

function runWranglerD1(cli, sql) {
  const envConfig = ENVS[cli.env];
  const tmpPath = path.join(os.tmpdir(), `pkic-migrate-members-${Date.now()}.sql`);
  fs.writeFileSync(tmpPath, sql, "utf8");
  const args = [
    "wrangler",
    "d1",
    "execute",
    cli.database,
    "--env",
    envConfig.wranglerEnv,
    envConfig.wranglerFlag,
    ...(cli.persistTo ? [`--persist-to=${cli.persistTo}`] : []),
    "--file",
    tmpPath,
  ];
  try {
    execFileSync("npx", args, { cwd: ROOT, stdio: "inherit" });
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

function uploadLogosToR2(cli, logoUploads) {
  const envConfig = ENVS[cli.env];
  for (const { filePath, r2Key } of logoUploads) {
    const args = [
      "wrangler",
      "r2",
      "object",
      "put",
      `${cli.logoBucket}/${r2Key}`,
      "--file",
      filePath,
      ...(envConfig.wranglerFlag === "--local" ? ["--local"] : []),
    ];
    execFileSync("npx", args, { cwd: ROOT, stdio: "inherit" });
  }
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  const { sql, report, logoUploads } = buildMigration({
    uploadLogos: cli.uploadLogos,
  });

  fs.mkdirSync(cli.outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const sqlOutPath = path.join(cli.outDir, `member-migration-${timestamp}.sql`);
  const jsonOutPath = path.join(cli.outDir, `member-migration-report-${timestamp}.json`);
  const mdOutPath = path.join(cli.outDir, `member-migration-report-${timestamp}.md`);

  fs.writeFileSync(sqlOutPath, sql, "utf8");
  fs.writeFileSync(jsonOutPath, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(mdOutPath, renderMarkdownReport(report), "utf8");

  console.log(`Wrote SQL to ${sqlOutPath}`);
  console.log(`Wrote report to ${mdOutPath} (${jsonOutPath})`);
  console.log(
    `${report.totals.matchedOrgs} matched, ${report.totals.sentinelIndividuals} individuals created with a placeholder email, ${report.totals.unmatched.length} unmatched, ${report.bareRosterUsers.length} bare roster users`,
  );

  if (cli.dryRun) {
    console.log("--dry-run: skipping wrangler execution and logo upload.");
    return;
  }

  runWranglerD1(cli, sql);

  if (cli.uploadLogos && logoUploads.length > 0) {
    console.log(`Uploading ${logoUploads.length} organization logos to R2 bucket ${cli.logoBucket}...`);
    uploadLogosToR2(cli, logoUploads);
  }
}

main();
