/**
 * SQL rendering: pure functions from already-reconciled data to SQL
 * statement strings, targeting the final (post Phase-1) schema. No file
 * I/O, no reconciliation — each function takes plain values and returns a
 * statement (or an array of statements) with no shared mutable state, so
 * the orchestrator collects everything itself into one statement list.
 */
import { randomUUID } from "node:crypto";
import { normalizeEmail, convertHugoShortcodes } from "./parsers.mjs";
import { normalizeOrgName } from "./reconciliation.mjs";

// ── SQL string helpers (matches scripts/seed-event.mjs conventions) ────────

export function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function toSqlNullableText(value) {
  if (value === null || value === undefined) return "NULL";
  const str = String(value).trim();
  return str.length === 0 ? "NULL" : sqlString(str);
}

/**
 * `organizations` upsert — no `membership_category`/`social_*` columns
 * (dropped by Phase 1; category lives in `member_category_assignments`,
 * social links in the canonical `links_json` array).
 */
export function buildUpsertOrganizationStatement({ slug, name, doc, logoR2Key }) {
  const normalizedOrgName = normalizeOrgName(name);
  const social = doc.social ?? {};
  const blog = doc.blog ?? {};
  const press = doc.press ?? {};
  const careers = doc.careers ?? {};
  const contentMarkdown = convertHugoShortcodes(doc.content);
  // YAML `id:` (e.g. `id: keyfactor`) backs the clean public URL slug
  // (`/members/<slug>`) — falls back to the filename-derived slug for the
  // (currently nonexistent) case of a file with no `id:` key at all.
  const urlSlug = String(doc.id ?? slug).trim() || slug;
  // Canonical persisted shape is a plain URL array (assets/shared/schemas/
  // api.ts's linksSchema) — no per-provider organizations.social_* columns.
  const links = [social.linkedin, social.x, social.facebook, social.instagram, social.youtube].filter(Boolean);
  const linksJson = links.length > 0 ? JSON.stringify(links) : null;

  const statement = `
INSERT INTO organizations (
  id, name, normalized_name, data_json, slug,
  description, website, content_markdown, slogan, logo_r2_key, links_json,
  blog_url, blog_feed_url, press_url, press_feed_url, careers_url,
  created_at, updated_at
) VALUES (
  ${sqlString(randomUUID())}, ${sqlString(name)}, ${sqlString(normalizedOrgName)}, NULL, ${toSqlNullableText(urlSlug)},
  ${toSqlNullableText(doc.description)}, ${toSqlNullableText(doc.website)}, ${toSqlNullableText(contentMarkdown)}, ${toSqlNullableText(doc.slogan)}, ${toSqlNullableText(logoR2Key)}, ${linksJson ? sqlString(linksJson) : "NULL"},
  ${toSqlNullableText(blog.url)}, ${toSqlNullableText(blog.feed)}, ${toSqlNullableText(press.url)}, ${toSqlNullableText(press.feed)}, ${toSqlNullableText(careers.url)},
  datetime('now'), datetime('now')
)
ON CONFLICT(normalized_name) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  website = excluded.website,
  content_markdown = excluded.content_markdown,
  slogan = excluded.slogan,
  logo_r2_key = COALESCE(excluded.logo_r2_key, organizations.logo_r2_key),
  links_json = COALESCE(organizations.links_json, excluded.links_json),
  -- Never clobber a slug staff may have hand-set via the admin UI after the
  -- initial migration — only fill when still unset.
  slug = COALESCE(organizations.slug, excluded.slug),
  blog_url = excluded.blog_url,
  blog_feed_url = excluded.blog_feed_url,
  press_url = excluded.press_url,
  press_feed_url = excluded.press_feed_url,
  careers_url = excluded.careers_url,
  updated_at = datetime('now');
`;

  return { statement, normalizedOrgName };
}

/** One statement per YAML `organizationDomains` entry — idempotent via the
 * table's global UNIQUE(domain) index (migration 0041). */
export function buildOrganizationDomainStatements(normalizedOrgName, domains) {
  const statements = [];
  for (const domain of domains) {
    const trimmed = String(domain).trim().toLowerCase();
    if (!trimmed) continue;
    statements.push(`
INSERT OR IGNORE INTO organization_domains (id, organization_id, domain, created_at)
SELECT ${sqlString(randomUUID())}, o.id, ${sqlString(trimmed)}, datetime('now')
FROM organizations o WHERE o.normalized_name = ${sqlString(normalizedOrgName)};
`);
  }
  return statements;
}

/**
 * Get-or-create the organization's single `members` aggregate row
 * (member_type='organization') plus its `member_category_assignments`
 * row — same `INSERT OR IGNORE` + unique-constraint idiom as
 * `getOrCreateOrganizationMemberAggregate` in
 * `functions/_lib/services/membership/memberships.ts`, keyed by a
 * `normalized_name` subquery instead of a known id since the organization
 * may already exist (ON CONFLICT) from a prior run.
 * `members.organization_id`/`member_category_assignments.member_id` are
 * both unique, so re-running this is a no-op once the rows exist.
 */
export function buildOrganizationMemberAggregateStatements(normalizedOrgName, categoryCode, memberSince) {
  const statements = [
    `
INSERT OR IGNORE INTO members (id, member_type, organization_id, status, member_since, created_at, updated_at)
SELECT ${sqlString(randomUUID())}, 'organization', o.id, 'active', ${toSqlNullableText(memberSince)}, datetime('now'), datetime('now')
FROM organizations o WHERE o.normalized_name = ${sqlString(normalizedOrgName)};
`,
    // Never clobber a `member_since` staff may have hand-set — only fill
    // in when it's still unset (e.g. a rerun after the YAML gained the key).
    `
UPDATE members SET member_since = COALESCE(member_since, ${toSqlNullableText(memberSince)}), updated_at = datetime('now')
WHERE organization_id = (SELECT id FROM organizations WHERE normalized_name = ${sqlString(normalizedOrgName)})
  AND member_since IS NULL;
`,
  ];
  if (categoryCode) {
    statements.push(`
INSERT OR IGNORE INTO member_category_assignments (member_id, category_code, created_at, updated_at)
SELECT m.id, ${sqlString(categoryCode)}, datetime('now'), datetime('now')
FROM members m JOIN organizations o ON o.id = m.organization_id
WHERE o.normalized_name = ${sqlString(normalizedOrgName)};
`);
  }
  return statements;
}

/**
 * One `organization_representatives` row for (org, user) — idempotent via
 * `uq_organization_representatives_active_pair` (migration 0037), the same
 * partial-unique-index guard `buildAddRepresentativeStatement` in
 * `functions/_lib/services/membership/representatives.ts` relies on.
 */
export function buildOrganizationRepresentativeStatement(normalizedOrgName, normalizedEmail, showOnOrgProfile) {
  return `
INSERT OR IGNORE INTO organization_representatives (id, member_id, user_id, show_on_org_profile, joined_at, left_at, created_at, updated_at)
SELECT ${sqlString(randomUUID())}, m.id, u.id, ${showOnOrgProfile ? 1 : 0}, datetime('now'), NULL, datetime('now'), datetime('now')
FROM members m
JOIN organizations o ON o.id = m.organization_id
JOIN users u ON u.normalized_email = ${sqlString(normalizedEmail)}
WHERE o.normalized_name = ${sqlString(normalizedOrgName)};
`;
}

/**
 * Grants a singleton representative role (primary/secondary contact) if the
 * organization doesn't already have an active holder — idempotent via
 * `uq_user_roles_single_holder_per_context` (migration 0038), the same
 * partial-unique-index guard the real assign-role statement builders rely
 * on. Never clobbers a contact staff already set by hand.
 */
export function buildRepresentativeRoleGrantStatement(normalizedOrgName, normalizedEmail, roleId) {
  return `
INSERT OR IGNORE INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, single_holder_per_context, created_at)
SELECT ${sqlString(randomUUID())}, u.id, ${sqlString(roleId)}, 'organization', m.id, NULL, 1, datetime('now')
FROM members m
JOIN organizations o ON o.id = m.organization_id
JOIN users u ON u.normalized_email = ${sqlString(normalizedEmail)}
WHERE o.normalized_name = ${sqlString(normalizedOrgName)};
`;
}

export function buildUpsertUserStatement({
  email,
  firstName,
  lastName,
  jobTitle,
  biography,
  linksJson,
  headshotR2Key,
}) {
  const normalizedEmail = normalizeEmail(email);
  const statement = `
INSERT INTO users (
  id, email, normalized_email, first_name, last_name, job_title, biography, links_json,
  headshot_r2_key, role, active, created_at, updated_at
) VALUES (
  ${sqlString(randomUUID())}, ${sqlString(email)}, ${sqlString(normalizedEmail)},
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
  updated_at = datetime('now'),
  -- 'headshots/...' keys are hand-uploaded via the admin self-service headshot
  -- endpoint (SPEAKER_UPLOADS_BUCKET) and must never be clobbered by a rerun.
  -- Anything else (NULL, or a previous 'member-photos/...' migration key) is
  -- fair game so a corrected/updated YAML photo actually takes effect on rerun.
  --
  -- Deliberately the LAST clause, ending the statement with "END;" rather
  -- than "END," followed by another clause. wrangler's local d1 execute
  -- SQL statement splitter (unstable_splitSqlQuery) only recognizes a CASE
  -- block as closed when END is immediately followed by a semicolon or
  -- whitespace -- "END," (comma, no space) never satisfies that, so the
  -- splitter's compound-statement tracking never pops and it silently
  -- merges every later statement in the file into this one until EOF,
  -- eventually failing with D1's 100KB per-statement SQLITE_TOOBIG limit
  -- once enough real data has accumulated. Confirmed against wrangler's
  -- own splitter directly; only affects local d1 execute --file/--command
  -- (--remote uploads the raw file for server-side ingestion instead, so
  -- real preview/production imports are unaffected).
  headshot_r2_key = CASE
    WHEN users.headshot_r2_key LIKE 'headshots/%' THEN users.headshot_r2_key
    ELSE COALESCE(excluded.headshot_r2_key, users.headshot_r2_key)
  END;
`;
  return { statement, normalizedEmail };
}

/**
 * Individual (org-less, H5/H6/H7) aggregate: one `members` row
 * (member_type='individual') plus its `member_category_assignments` row.
 * `members.user_id` is unique, so `INSERT OR IGNORE` is the whole race
 * guard — matches `buildCreateIndividualMemberStatements` in
 * `functions/_lib/services/membership/memberships.ts`, just tolerant of
 * reruns (this script's own callers, unlike a live request, may execute
 * against an aggregate that already exists).
 */
export function buildIndividualMemberAggregateStatements(normalizedEmail, categoryCode, memberSince) {
  const statements = [
    `
INSERT OR IGNORE INTO members (id, member_type, user_id, status, member_since, created_at, updated_at)
SELECT ${sqlString(randomUUID())}, 'individual', u.id, 'active', ${toSqlNullableText(memberSince)}, datetime('now'), datetime('now')
FROM users u WHERE u.normalized_email = ${sqlString(normalizedEmail)};
`,
    `
UPDATE members SET member_since = COALESCE(member_since, ${toSqlNullableText(memberSince)}), updated_at = datetime('now')
WHERE user_id = (SELECT id FROM users WHERE normalized_email = ${sqlString(normalizedEmail)})
  AND member_since IS NULL;
`,
  ];
  if (categoryCode) {
    statements.push(`
INSERT OR IGNORE INTO member_category_assignments (member_id, category_code, created_at, updated_at)
SELECT m.id, ${sqlString(categoryCode)}, datetime('now'), datetime('now')
FROM members m JOIN users u ON u.id = m.user_id
WHERE u.normalized_email = ${sqlString(normalizedEmail)};
`);
  }
  return statements;
}

/**
 * Consortium-wide sponsorship for an org-tied member (data/members/*.yaml
 * `sponsor.level`/`sponsor.since`). Guarded by NOT EXISTS instead of an
 * ON CONFLICT target (sponsorships has no natural unique key for "this
 * org's consortium sponsorship") so re-running the migration doesn't
 * duplicate rows, but also doesn't clobber a tier staff later changed by
 * hand via the admin Sponsorships screen.
 */
export function buildConsortiumSponsorshipStatements(normalizedOrgName, level, startDate) {
  return [
    `
INSERT INTO sponsorships (id, sponsor_type, organization_id, tier, pipeline_stage, start_date, created_at, updated_at)
SELECT ${sqlString(randomUUID())}, 'consortium', o.id, ${sqlString(level)}, 'active', ${toSqlNullableText(startDate)}, datetime('now'), datetime('now')
FROM organizations o
WHERE o.normalized_name = ${sqlString(normalizedOrgName)}
  AND NOT EXISTS (SELECT 1 FROM sponsorships s WHERE s.organization_id = o.id AND s.sponsor_type = 'consortium');
`,
    `
UPDATE organizations
SET sponsor_tier = COALESCE(sponsor_tier, ${sqlString(level)}),
    sponsor_start_date = COALESCE(sponsor_start_date, ${toSqlNullableText(startDate)}),
    updated_at = datetime('now')
WHERE normalized_name = ${sqlString(normalizedOrgName)};
`,
  ];
}

/** Per-event sponsorship for an org-tied member, against a resolved `EVENT_NAME_ALIASES` entry. */
export function buildEventSponsorshipStatements(normalizedOrgName, alias, tier) {
  return [
    `
INSERT INTO events (id, slug, name, timezone, starts_at, ends_at, created_at, updated_at)
VALUES (${sqlString(randomUUID())}, ${sqlString(alias.slug)}, ${sqlString(alias.name)}, ${sqlString(alias.timezone)}, ${toSqlNullableText(alias.startsAt)}, ${toSqlNullableText(alias.endsAt)}, datetime('now'), datetime('now'))
ON CONFLICT(slug) DO NOTHING;
`,
    `
INSERT INTO sponsorships (id, sponsor_type, organization_id, event_id, tier, pipeline_stage, created_at, updated_at)
SELECT ${sqlString(randomUUID())}, 'event', o.id, e.id, ${sqlString(tier)}, 'active', datetime('now'), datetime('now')
FROM organizations o, events e
WHERE o.normalized_name = ${sqlString(normalizedOrgName)}
  AND e.slug = ${sqlString(alias.slug)}
  AND NOT EXISTS (
    SELECT 1 FROM sponsorships s WHERE s.organization_id = o.id AND s.sponsor_type = 'event' AND s.event_id = e.id
  );
`,
  ];
}

/** Consortium-wide sponsorship for a non-member sponsor (data/sponsors.yaml). */
export function buildNonMemberConsortiumSponsorshipStatement(sponsorName, website, logoR2Key, level) {
  return `
INSERT INTO sponsorships (id, sponsor_type, non_member_name, non_member_website, non_member_logo_r2_key, tier, pipeline_stage, created_at, updated_at)
SELECT ${sqlString(randomUUID())}, 'consortium', ${sqlString(sponsorName)}, ${toSqlNullableText(website)}, ${toSqlNullableText(logoR2Key)}, ${sqlString(level)}, 'active', datetime('now'), datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM sponsorships WHERE sponsor_type = 'consortium' AND organization_id IS NULL AND non_member_name = ${sqlString(sponsorName)}
);
`;
}

/** Per-event sponsorship for a non-member sponsor, against a resolved `EVENT_NAME_ALIASES` entry. */
export function buildNonMemberEventSponsorshipStatements(sponsorName, website, logoR2Key, alias, tier) {
  return [
    `
INSERT INTO events (id, slug, name, timezone, starts_at, ends_at, created_at, updated_at)
VALUES (${sqlString(randomUUID())}, ${sqlString(alias.slug)}, ${sqlString(alias.name)}, ${sqlString(alias.timezone)}, ${toSqlNullableText(alias.startsAt)}, ${toSqlNullableText(alias.endsAt)}, datetime('now'), datetime('now'))
ON CONFLICT(slug) DO NOTHING;
`,
    `
INSERT INTO sponsorships (id, sponsor_type, non_member_name, non_member_website, non_member_logo_r2_key, event_id, tier, pipeline_stage, created_at, updated_at)
SELECT ${sqlString(randomUUID())}, 'event', ${sqlString(sponsorName)}, ${toSqlNullableText(website)}, ${toSqlNullableText(logoR2Key)}, e.id, ${sqlString(tier)}, 'active', datetime('now'), datetime('now')
FROM events e
WHERE e.slug = ${sqlString(alias.slug)}
  AND NOT EXISTS (
    SELECT 1 FROM sponsorships s
    WHERE s.sponsor_type = 'event' AND s.organization_id IS NULL AND s.non_member_name = ${sqlString(sponsorName)} AND s.event_id = e.id
  );
`,
  ];
}

export function buildWorkingGroupMemberStatement(wgSlug, email) {
  const wgIdExpr = `(SELECT id FROM working_groups WHERE slug = ${sqlString(wgSlug)})`;
  return `
INSERT INTO working_group_members (id, working_group_id, user_id, joined_at, left_at)
SELECT ${sqlString(randomUUID())}, ${wgIdExpr}, (SELECT id FROM users WHERE normalized_email = ${sqlString(email)}), datetime('now'), NULL
WHERE (SELECT id FROM users WHERE normalized_email = ${sqlString(email)}) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM working_group_members wgm
    WHERE wgm.working_group_id = ${wgIdExpr}
      AND wgm.user_id = (SELECT id FROM users WHERE normalized_email = ${sqlString(email)})
      AND wgm.left_at IS NULL
  );
`;
}
