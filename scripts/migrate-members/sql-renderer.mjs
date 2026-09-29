/**
 * SQL rendering: pure functions from already-reconciled data to SQL
 * statement strings, targeting the final (post Phase-1) schema. No file
 * I/O, no reconciliation — each function takes plain values and returns a
 * statement (or an array of statements) with no shared mutable state, so
 * the orchestrator collects everything itself into one statement list.
 */
import { randomUUID } from "node:crypto";
import { activeUserCapacitiesCte } from "../../functions/_lib/services/membership/capacity-query.ts";
import { normalizeEmail, convertHugoShortcodes } from "./parsers.mjs";
import { normalizeOrgName } from "./reconciliation.mjs";
import { normalizeLinks, serializeLinks } from "../../assets/shared/schemas/links.ts";
import { sqlString, toSqlNullableText } from "../lib/sql.mjs";

export { sqlString, toSqlNullableText } from "../lib/sql.mjs";

/**
 * Canonical `links_json` codec entry point for the importer — validates
 * against the same `linksSchema` (URL format, http(s)-only, max 15
 * entries, no duplicates) that every runtime write path uses, instead of a
 * raw `JSON.stringify`. A single malformed link in one YAML file (real
 * examples found in production data: "ttps://..." typos missing the
 * leading "h") must not abort the entire multi-hundred-organization
 * import — invalid or duplicate entries are dropped and reported via
 * `onInvalid` instead of thrown. The final, filtered list is still run
 * through `linksSchema.parse` as a canonical-contract guarantee (belt and
 * suspenders — should always pass given the pre-filtering below, but this
 * is what actually enforces "never persist something linksSchema would
 * reject", not just "we tried to filter"). Returns `null` for an empty
 * (or fully-filtered-out) list, matching every call site's prior
 * null-when-empty convention.
 *
 * @param {string[] | null | undefined} links
 * @param {(url: string) => void} [onInvalid]
 */
export function buildLinksJson(links, onInvalid = () => {}) {
  if (!links || links.length === 0) return null;
  const normalized = normalizeLinks(links);
  for (const rejected of normalized.rejected) onInvalid(rejected);
  return normalized.links.length > 0 ? serializeLinks(normalized.links) : null;
}

/**
 * `organizations` upsert — no `membership_category`/`social_*` columns
 * (dropped by Phase 1; category lives in `member_category_assignments`,
 * social links in the canonical `links_json` array).
 *
 * @param {{ slug: string, name: string, doc: Record<string, any>, logoR2Key: string | null, onInvalidLink?: (url: string) => void }} input
 */
export function buildUpsertOrganizationStatement({ slug, name, doc, logoR2Key, onInvalidLink = () => {} }) {
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
  // Canonical persisted shape is linksSchema's plain URL array; no
  // per-provider organizations.social_* columns.
  const links = [social.linkedin, social.x, social.facebook, social.instagram, social.youtube].filter(Boolean);
  const linksJson = buildLinksJson(links, onInvalidLink);

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
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
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
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
`;

  return { statement, normalizedOrgName };
}

/** One statement per YAML `organizationDomains` entry — idempotent via the
 * canonical claim registry's UNIQUE(domain) invariant. */
export function buildOrganizationDomainStatements(normalizedOrgName, domains) {
  const statements = [];
  for (const domain of domains) {
    const trimmed = String(domain).trim().toLowerCase();
    if (!trimmed) continue;
    statements.push(`
INSERT OR IGNORE INTO organization_domain_claims
  (id, organization_id, application_id, domain, created_at, updated_at)
SELECT ${sqlString(randomUUID())}, o.id, NULL, ${sqlString(trimmed)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
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
SELECT ${sqlString(randomUUID())}, 'organization', o.id, 'active', ${toSqlNullableText(memberSince)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM organizations o WHERE o.normalized_name = ${sqlString(normalizedOrgName)};
`,
    // Never clobber a `member_since` staff may have hand-set — only fill
    // in when it's still unset (e.g. a rerun after the YAML gained the key).
    `
UPDATE members SET member_since = COALESCE(member_since, ${toSqlNullableText(memberSince)}), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE organization_id = (SELECT id FROM organizations WHERE normalized_name = ${sqlString(normalizedOrgName)})
  AND member_since IS NULL;
`,
  ];
  if (categoryCode) {
    statements.push(`
INSERT OR IGNORE INTO member_category_assignments (member_id, category_code, created_at, updated_at)
SELECT m.id, ${sqlString(categoryCode)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM members m JOIN organizations o ON o.id = m.organization_id
WHERE o.normalized_name = ${sqlString(normalizedOrgName)};
`);
  }
  return statements;
}

/**
 * One durable active identity row for each (organization, user) pair.
 * INSERT OR IGNORE keeps the migration importer idempotent without changing
 * an existing association's source or lifecycle state.
 * @param {string} normalizedOrgName
 * @param {string} normalizedEmail
 * @param {boolean} showOnOrgProfile
 * @param {{ jobTitle?: string | null, biography?: string | null, linksJson?: string | null }} [profile]
 */
export function buildActingIdentityStatement(
  normalizedOrgName,
  normalizedEmail,
  showOnOrgProfile,
  { jobTitle = null, biography = null, linksJson = null } = {},
) {
  return `
INSERT INTO identities
  (id, user_id, organization_id, email_id, job_title, biography, links_json,
   source, show_on_organization_profile, invited_at, started_at, created_at, updated_at)
SELECT ${sqlString(randomUUID())}, u.id, o.id, NULL,
       ${toSqlNullableText(jobTitle)}, ${toSqlNullableText(biography)}, ${linksJson ? sqlString(linksJson) : "NULL"},
       'migration', ${showOnOrgProfile ? 1 : 0}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM organizations o
JOIN users u ON u.id = ${ownerUserIdForEmail(normalizedEmail)}
WHERE o.normalized_name = ${sqlString(normalizedOrgName)}
ON CONFLICT(user_id, organization_id)
  WHERE organization_id IS NOT NULL
    AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL
DO UPDATE SET
  job_title = COALESCE(identities.job_title, excluded.job_title),
  biography = COALESCE(identities.biography, excluded.biography),
  links_json = COALESCE(identities.links_json, excluded.links_json),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
`;
}

/**
 * Grants a singleton representative role (primary/secondary contact) if the
 * organization doesn't already have an active holder — idempotent via
 * `uq_user_roles_single_holder_per_context` (consolidated migration 0035), the same
 * partial-unique-index guard the real assign-role statement builders rely
 * on. Never clobbers a contact staff already set by hand.
 */
export function buildRepresentativeRoleGrantStatement(normalizedOrgName, normalizedEmail, roleId) {
  return `
INSERT OR IGNORE INTO user_roles
  (id, user_id, role_id, context_type, context_id, identity_id,
   granted_by_user_id, single_holder_per_context, created_at)
SELECT ${sqlString(randomUUID())}, u.id, ${sqlString(roleId)}, 'organization', m.id,
       identity.id, NULL, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM members m
JOIN organizations o ON o.id = m.organization_id
JOIN users u ON u.id = ${ownerUserIdForEmail(normalizedEmail)}
JOIN identities identity
  ON identity.user_id = u.id
 AND identity.organization_id = o.id
 AND identity.started_at IS NOT NULL
 AND identity.ended_at IS NULL
 AND identity.blocked_at IS NULL
WHERE o.normalized_name = ${sqlString(normalizedOrgName)};
`;
}

/**
 * One address is one reservation across the whole account namespace:
 * `users.normalized_email`, `user_emails.normalized_email` and
 * `users.pending_email` all draw from it, and the reservation triggers
 * added by consolidated migration 0035 abort any statement that crosses
 * another account's claim. Every statement that needs "the account this
 * member's address belongs to" resolves it through this one scalar
 * subquery instead of assuming the address is always a primary login:
 * an address already held as an alternate belongs to that same person,
 * so their identity, membership, role and group rows attach to the
 * account that owns it rather than silently matching nothing.
 *
 * Two kinds of claim deliberately resolve to no account at all, because
 * neither is a person the importer may write to:
 *   - a pending (unconfirmed) email change only reserves the address;
 *   - a redacted or merged account is not a live account any more, and
 *     re-populating a redacted name or biography from the YAML directory
 *     would undo an erasure.
 * Both surface in the post-import reservation check instead — see
 * scripts/migrate-members/email-reservations.mjs.
 */
export function ownerUserIdForEmail(normalizedEmail) {
  return ownerUserIdForEmailExpression(sqlString(normalizedEmail));
}

/**
 * The same resolution over a SQL expression rather than a known address,
 * so a correlated query — "does this reserved address already have a live
 * account behind it?" — asks exactly what the import itself asked, from
 * one definition.
 */
export function ownerUserIdForEmailExpression(emailExpression) {
  return `(SELECT live.id FROM users live
            WHERE live.normalized_email = ${emailExpression}
              AND live.pii_redacted_at IS NULL AND live.merged_into_user_id IS NULL
           UNION ALL
           SELECT alternate.user_id FROM user_emails alternate
             JOIN users owner ON owner.id = alternate.user_id
              AND owner.pii_redacted_at IS NULL AND owner.merged_into_user_id IS NULL
            WHERE alternate.normalized_email = ${emailExpression}
            LIMIT 1)`;
}

/**
 * Creates the account for an address nothing has claimed yet, then fills
 * the profile gaps of whichever live account owns that address.
 *
 * This is deliberately not an `ON CONFLICT(normalized_email)` upsert.
 * `trg_users_primary_email_reservation_insert` fires *before* SQLite
 * detects the conflict, so a plain upsert aborts the entire import file
 * with `EMAIL_TAKEN` as soon as one directory address is held elsewhere
 * in the namespace — as an alternate address, or (the case a production
 * database really produces) as some account's unconfirmed pending email
 * change. Guarding the insert keeps one reserved address a single
 * reported record instead of a failed migration, and the separate update
 * keeps the previous COALESCE fill-the-gaps semantics for the owner,
 * including the account reached through an alternate address.
 */
export function buildUpsertUserStatements({
  email,
  firstName,
  lastName,
  jobTitle,
  biography,
  linksJson,
  headshotR2Key,
}) {
  const normalizedEmail = normalizeEmail(email);
  const emailLiteral = sqlString(normalizedEmail);
  const createAccount = `
INSERT INTO users (
  id, email, normalized_email, first_name, last_name, job_title, biography, links_json,
  headshot_r2_key, role, active, created_at, updated_at
)
SELECT ${sqlString(randomUUID())}, ${sqlString(email)}, ${emailLiteral},
  ${toSqlNullableText(firstName)}, ${toSqlNullableText(lastName)}, ${toSqlNullableText(jobTitle)},
  ${toSqlNullableText(biography)}, ${linksJson ? sqlString(linksJson) : "NULL"},
  ${toSqlNullableText(headshotR2Key)},
  'user', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE normalized_email = ${emailLiteral} OR pending_email = ${emailLiteral}
) AND NOT EXISTS (
  SELECT 1 FROM user_emails WHERE normalized_email = ${emailLiteral}
);
`;
  const fillProfileGaps = `
UPDATE users SET
  first_name = COALESCE(first_name, ${toSqlNullableText(firstName)}),
  last_name = COALESCE(last_name, ${toSqlNullableText(lastName)}),
  job_title = COALESCE(job_title, ${toSqlNullableText(jobTitle)}),
  biography = COALESCE(biography, ${toSqlNullableText(biography)}),
  links_json = COALESCE(links_json, ${linksJson ? sqlString(linksJson) : "NULL"}),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
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
    WHEN headshot_r2_key LIKE 'headshots/%' THEN headshot_r2_key
    ELSE COALESCE(${toSqlNullableText(headshotR2Key)}, headshot_r2_key)
  END
WHERE id = ${ownerUserIdForEmail(normalizedEmail)};
`;
  return { statements: [createAccount, fillProfileGaps], normalizedEmail };
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
export function buildIndividualMemberAggregateStatements(
  normalizedEmail,
  categoryCode,
  memberSince,
  { biography = null, linksJson = null } = {},
) {
  const statements = [
    `
INSERT OR IGNORE INTO members (id, member_type, user_id, status, member_since, created_at, updated_at)
SELECT ${sqlString(randomUUID())}, 'individual', u.id, 'active', ${toSqlNullableText(memberSince)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM users u WHERE u.id = ${ownerUserIdForEmail(normalizedEmail)};
`,
    `
UPDATE members SET member_since = COALESCE(member_since, ${toSqlNullableText(memberSince)}), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE user_id = ${ownerUserIdForEmail(normalizedEmail)}
  AND member_since IS NULL;
`,
  ];
  if (categoryCode) {
    statements.push(`
INSERT OR IGNORE INTO member_category_assignments (member_id, category_code, created_at, updated_at)
SELECT m.id, ${sqlString(categoryCode)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM members m JOIN users u ON u.id = m.user_id
WHERE u.id = ${ownerUserIdForEmail(normalizedEmail)};
`);
    statements.push(`
INSERT INTO identities
  (id, user_id, organization_id, email_id, job_title, biography, links_json,
   source, show_on_organization_profile, invited_at, started_at, created_at, updated_at)
SELECT ${sqlString(randomUUID())}, u.id, NULL, NULL, NULL,
       ${toSqlNullableText(biography)}, ${linksJson ? sqlString(linksJson) : "NULL"},
       'migration', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM users u
  JOIN members member ON member.user_id = u.id AND member.member_type = 'individual'
  JOIN member_category_assignments category ON category.member_id = member.id
 WHERE u.id = ${ownerUserIdForEmail(normalizedEmail)}
   AND category.category_code IN ('H5', 'H6', 'H7')
ON CONFLICT(user_id)
  WHERE organization_id IS NULL
    AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL
DO UPDATE SET
  biography = COALESCE(identities.biography, excluded.biography),
  links_json = COALESCE(identities.links_json, excluded.links_json),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
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
SELECT ${sqlString(randomUUID())}, 'consortium', o.id, ${sqlString(level)}, 'active', ${toSqlNullableText(startDate)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM organizations o
WHERE o.normalized_name = ${sqlString(normalizedOrgName)}
  AND NOT EXISTS (SELECT 1 FROM sponsorships s WHERE s.organization_id = o.id AND s.sponsor_type = 'consortium');
`,
    `
UPDATE organizations
SET sponsor_tier = COALESCE(sponsor_tier, ${sqlString(level)}),
    sponsor_start_date = COALESCE(sponsor_start_date, ${toSqlNullableText(startDate)}),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE normalized_name = ${sqlString(normalizedOrgName)};
`,
  ];
}

function buildEventUpsertStatement(alias) {
  return `
INSERT INTO events (id, slug, name, timezone, starts_at, ends_at, created_at, updated_at)
VALUES (${sqlString(randomUUID())}, ${sqlString(alias.slug)}, ${sqlString(alias.name)}, ${sqlString(alias.timezone)}, ${toSqlNullableText(alias.startsAt)}, ${toSqlNullableText(alias.endsAt)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(slug) DO NOTHING;
`;
}

/** Per-event sponsorship for an org-tied member, against a resolved `EVENT_NAME_ALIASES` entry. */
export function buildEventSponsorshipStatements(normalizedOrgName, alias, tier) {
  return [
    buildEventUpsertStatement(alias),
    `
INSERT INTO sponsorships (id, sponsor_type, organization_id, event_id, tier, pipeline_stage, created_at, updated_at)
SELECT ${sqlString(randomUUID())}, 'event', o.id, e.id, ${sqlString(tier)}, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
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
SELECT ${sqlString(randomUUID())}, 'consortium', ${sqlString(sponsorName)}, ${toSqlNullableText(website)}, ${toSqlNullableText(logoR2Key)}, ${sqlString(level)}, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (
  SELECT 1 FROM sponsorships WHERE sponsor_type = 'consortium' AND organization_id IS NULL AND non_member_name = ${sqlString(sponsorName)}
);
`;
}

/** Per-event sponsorship for a non-member sponsor, against a resolved `EVENT_NAME_ALIASES` entry. */
export function buildNonMemberEventSponsorshipStatements(sponsorName, website, logoR2Key, alias, tier) {
  return [
    buildEventUpsertStatement(alias),
    `
INSERT INTO sponsorships (id, sponsor_type, non_member_name, non_member_website, non_member_logo_r2_key, event_id, tier, pipeline_stage, created_at, updated_at)
SELECT ${sqlString(randomUUID())}, 'event', ${sqlString(sponsorName)}, ${toSqlNullableText(website)}, ${toSqlNullableText(logoR2Key)}, e.id, ${sqlString(tier)}, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM events e
WHERE e.slug = ${sqlString(alias.slug)}
  AND NOT EXISTS (
    SELECT 1 FROM sponsorships s
    WHERE s.sponsor_type = 'event' AND s.organization_id IS NULL AND s.non_member_name = ${sqlString(sponsorName)} AND s.event_id = e.id
  );
`,
  ];
}

export function buildGroupMembershipStatement(groupSlug, email, groupType = "working_group", joinedAt = null) {
  const capacitiesCte = activeUserCapacitiesCte(
    `SELECT id FROM users WHERE id = ${ownerUserIdForEmail(email)} AND active = 1`,
  );
  return `
${capacitiesCte}
INSERT OR IGNORE INTO group_memberships
  (id, group_id, user_id, identity_id, member_id, source, created_by_user_id,
   joined_at, left_at, created_at, updated_at)
SELECT lower(hex(randomblob(16))), group_row.id, capacity.user_id,
       capacity.identity_id, capacity.member_id, 'migration', NULL,
       ${joinedAt ? sqlString(joinedAt) : "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"}, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM active_user_capacities capacity
  JOIN groups group_row
    ON group_row.slug = ${sqlString(groupSlug)}
   AND group_row.type_key = ${sqlString(groupType)}
   AND group_row.active = 1;
${
  joinedAt
    ? `UPDATE group_memberships SET joined_at = ${sqlString(joinedAt)}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE source = 'migration' AND left_at IS NULL AND joined_at <> ${sqlString(joinedAt)}
   AND user_id = ${ownerUserIdForEmail(email)}
   AND group_id IN (SELECT id FROM groups WHERE slug = ${sqlString(groupSlug)} AND type_key = ${sqlString(groupType)} AND active = 1);`
    : ""
}
`;
}

/**
 * Every imported member's automatic group memberships — the All Members
 * community group and any other category-enrolling group — written the way
 * the portal writes them when a capacity changes. The roster statements
 * above only seat the working groups the Google Groups exports name; without
 * this the community group stayed empty after an import, so its mailing list
 * subscribed nobody by default (#86, #103).
 */
export function buildAutomaticEnrollmentStatement() {
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  return `
${activeUserCapacitiesCte("SELECT id FROM users WHERE active = 1")}
INSERT OR IGNORE INTO group_memberships
  (id, group_id, user_id, identity_id, member_id, source, created_by_user_id,
   joined_at, left_at, created_at, updated_at)
SELECT lower(hex(randomblob(16))), group_row.id, capacity.user_id, capacity.identity_id, capacity.member_id,
       'automatic_policy', NULL, ${now}, NULL, ${now}, ${now}
  FROM active_user_capacities capacity
  JOIN group_membership_category_rules rule
    ON rule.membership_category_code = capacity.membership_category
   AND rule.permits_join = 1 AND rule.automatic_enrollment = 1
  JOIN groups group_row
    ON group_row.id = rule.group_id AND group_row.active = 1
   AND group_row.parent_group_id IS NULL AND group_row.automatic_enrollment_mode = 'category'
  LEFT JOIN group_automatic_enrollment_opt_outs opt_out
    ON opt_out.group_id = group_row.id AND opt_out.user_id = capacity.user_id
 WHERE (group_row.allow_automatic_opt_out = 0 OR opt_out.user_id IS NULL)
   AND NOT EXISTS (
     SELECT 1 FROM group_memberships existing
      WHERE existing.group_id = group_row.id AND existing.user_id = capacity.user_id
        AND existing.member_id = capacity.member_id AND existing.left_at IS NULL
   );
`;
}
