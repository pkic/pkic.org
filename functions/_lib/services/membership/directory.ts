import { first } from "../../db/queries";
import { batchFirst, batchRows, queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { parseJsonSafe } from "../../utils/json";
import { parseLinksJson, getFeaturedLink } from "../../../../assets/shared/schemas/links";
import { sanitizeLegacyHttpOrSameOriginUrl, sanitizeLegacyHttpUrl } from "../../../../assets/shared/schemas/urls";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import type {
  MembersListQuery,
  PublicMemberDetail,
  PublicMemberSummary,
} from "../../../../assets/shared/schemas/members-directory";

/**
 * Public member directory. D1 is the source of truth,
 * populated from data/members/*.yaml by scripts/migrate-members-yaml-to-d1.mjs.
 * Most content fields (description/website/slogan/content/blog/
 * press/careers/social) live on the real `organizations` columns added in
 * consolidated migration 0035 — `data_json` predates that migration and is nothing writes
 * to it anymore, but it's kept as a fallback source for any row that only
 * has it set (e.g. rows seeded directly in tests).
 *
 * Design note: `members` holds exactly one aggregate row per organization
 * (base schema plus consolidated migration 0035) — a public directory entry is one row per
 * *organization* (or one row per individual, org-less member), with N
 * active organizational identities resolved separately for the detail
 * view's identity roster, read together in one D1 batch.
 */

interface OrgDataJson {
  website?: string;
  description?: string;
  logoUrl?: string;
  slogan?: string;
}

interface DirectoryRow {
  member_id: string;
  organization_id: string | null;
  org_slug: string | null;
  org_name: string | null;
  org_data_json: string | null;
  org_description: string | null;
  org_website: string | null;
  org_slogan: string | null;
  org_logo_r2_key: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  headshot_r2_key: string | null;
  category_code: string;
  tier: string | null;
  member_since: string | null;
  created_at: string;
}

function toSummary(row: DirectoryRow): PublicMemberSummary {
  const orgData = parseJsonSafe<OrgDataJson>(row.org_data_json, {});
  const isIndividual = !row.organization_id;
  const name = row.organization_id
    ? (row.org_name ?? "Unknown organization")
    : [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown member";

  const logoUrl = row.organization_id
    ? row.org_logo_r2_key
      ? `/api/v1/members/${row.organization_id}/logo`
      : sanitizeLegacyHttpOrSameOriginUrl(orgData.logoUrl)
    : row.headshot_r2_key
      ? `/api/v1/members/${row.member_id}/logo`
      : null;

  return {
    id: row.organization_id ?? row.member_id,
    // Org-less individuals have no organizations row to hold a slug on —
    // they keep UUID-keyed profile URLs (see functions/members/[slug].ts).
    slug: row.organization_id ? row.org_slug : null,
    name,
    memberType: row.category_code,
    tier: row.tier,
    website: sanitizeLegacyHttpUrl(row.org_website ?? orgData.website),
    description: row.org_description ?? orgData.description ?? (isIndividual ? row.biography : null) ?? null,
    slogan: row.org_slogan ?? orgData.slogan ?? null,
    logoUrl,
    // Falls back to the row's creation time for records that predate
    // consolidated migration 0035 (or a creation path that didn't supply a real one).
    memberSince: row.member_since ?? row.created_at,
  };
}

const DIRECTORY_COLUMNS = `
  m.id AS member_id, m.organization_id, o.slug AS org_slug, o.name AS org_name, o.data_json AS org_data_json,
         o.description AS org_description, o.website AS org_website, o.slogan AS org_slogan,
         o.logo_r2_key AS org_logo_r2_key,
         u.first_name, u.last_name,
         CASE WHEN m.organization_id IS NULL THEN mc.label ELSE NULL END AS job_title,
         individual_identity.biography, individual_identity.links_json, u.headshot_r2_key,
         mca.category_code, m.tier, m.member_since, m.created_at`;
const DIRECTORY_FROM = `
  FROM members m
  LEFT JOIN organizations o ON o.id = m.organization_id
  LEFT JOIN users u ON u.id = m.user_id
  JOIN member_category_assignments mca ON mca.member_id = m.id
  JOIN membership_categories mc ON mc.code = mca.category_code
  LEFT JOIN identities individual_identity
    ON individual_identity.user_id = m.user_id
   AND individual_identity.organization_id IS NULL
   AND individual_identity.started_at IS NOT NULL
   AND individual_identity.ended_at IS NULL
   AND individual_identity.blocked_at IS NULL
  WHERE m.status = 'active'
`;
const DIRECTORY_SELECT = `SELECT ${DIRECTORY_COLUMNS} ${DIRECTORY_FROM}`;

interface MemberDetailRow extends DirectoryRow {
  content_markdown: string | null;
  blog_url: string | null;
  blog_feed_url: string | null;
  press_url: string | null;
  press_feed_url: string | null;
  careers_url: string | null;
  organization_links_json: string | null;
}

/** group: "organization" = org-tied categories; "independent" = org-less H5/H6/H7 */
export async function listPublicMembers(
  db: DatabaseLike,
  params: MembersListQuery,
): Promise<{ members: PublicMemberSummary[]; total: number }> {
  const conditions: string[] = [];
  const args: unknown[] = [];

  if (params.group === "independent") {
    conditions.push("m.organization_id IS NULL");
  } else if (params.group === "organization") {
    conditions.push("m.organization_id IS NOT NULL");
  }

  /*
   * A member with somebody seated in the group, counted once however many
   * people it seats: the roll lists aggregates, and representatives inherit
   * the membership rather than each holding one. Everything behind a seat has
   * to be live — the person, the identity they hold it through, and the
   * membership that identity acts for — which is the same predicate the
   * group's own roster reads.
   */
  if (params.workingGroup) {
    conditions.push(`EXISTS (
      SELECT 1
        FROM group_memberships membership
        JOIN groups g ON g.id = membership.group_id AND (g.slug = ? OR g.id = ?)
        JOIN users seated ON seated.id = membership.user_id AND seated.active = 1
        JOIN identities identity ON identity.id = membership.identity_id
         AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
       WHERE membership.member_id = m.id AND membership.left_at IS NULL
    )`);
    args.push(params.workingGroup, params.workingGroup);
  }

  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, [
      "o.name",
      "u.first_name",
      "u.last_name",
      "u.first_name || ' ' || u.last_name",
    ]);
    conditions.push(search.sql);
    args.push(...search.bindings);
  }

  const extraWhere = conditions.length ? ` AND ${conditions.join(" AND ")}` : "";
  const orderBy = resolveMappedOrderBy(
    params.sort,
    {
      name: "COALESCE(o.name, u.last_name, u.first_name)",
      memberSince: "COALESCE(m.member_since, m.created_at)",
    },
    "COALESCE(o.name, u.last_name, u.first_name) ASC",
    "m.id ASC",
  );

  const { rows, total } = await queryPage<DirectoryRow>(db, {
    sql: `${DIRECTORY_SELECT}${extraWhere}`,
    bindings: args,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });

  return { members: rows.map(toSummary), total };
}

interface PublicIdentityRow {
  identity_id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  headshot_r2_key: string | null;
}

function toPublicIdentity(row: PublicIdentityRow): PublicMemberDetail["identities"][number] {
  const links = parseLinksJson(row.links_json);
  return {
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown",
    jobTitle: row.job_title,
    bio: row.biography,
    featuredLink: getFeaturedLink(links),
    links,
    photoUrl: row.headshot_r2_key ? `/api/v1/members/${row.identity_id}/logo` : null,
  };
}

/** `idOrSlug` resolves against an organization's UUID primary key, its clean
 * URL slug (organizations.slug, consolidated migration 0035), or — for org-less
 * individuals, which have no organizations row — the member's own id. */
export async function getPublicMemberById(db: DatabaseLike, idOrSlug: string): Promise<PublicMemberDetail | null> {
  const profileSql = `SELECT ${DIRECTORY_COLUMNS}, o.content_markdown, o.blog_url, o.blog_feed_url,
            o.press_url, o.press_feed_url, o.careers_url, o.links_json AS organization_links_json
     ${DIRECTORY_FROM}
       AND (m.organization_id = ? OR m.organization_id = (SELECT id FROM organizations WHERE slug = ?)
            OR (m.organization_id IS NULL AND m.id = ?))
     ORDER BY m.id ASC, mca.category_code ASC LIMIT 1`;
  const bindings = [idOrSlug, idOrSlug, idOrSlug];
  // Reuse the exact, deterministic member selection inside the roster query.
  // Both reads share one transaction/round trip without serializing a roster
  // into a single potentially oversized D1 JSON row.
  const [profileResult, identitiesResult] = await db.batch([
    db.prepare(profileSql).bind(...bindings),
    db
      .prepare(
        `SELECT identity.id AS identity_id, u.first_name, u.last_name,
                identity.job_title, identity.biography, identity.links_json, u.headshot_r2_key
         FROM identities identity
         JOIN users u ON u.id = identity.user_id
         WHERE identity.organization_id = (SELECT organization_id FROM (${profileSql}) AS selected_member)
           AND identity.started_at IS NOT NULL
           AND identity.ended_at IS NULL
           AND identity.blocked_at IS NULL
           AND identity.show_on_organization_profile = 1
         ORDER BY u.last_name ASC, u.first_name ASC, identity.id ASC`,
      )
      .bind(...bindings),
  ]);
  const row = batchFirst<MemberDetailRow>(profileResult);
  if (!row) return null;

  const summary = toSummary(row);
  const userLinks = parseLinksJson(row.links_json);
  const identities = batchRows<PublicIdentityRow>(identitiesResult).map(toPublicIdentity);

  // An organization's public links belong to the organization row; an org-less
  // individual's belong to their own user record.
  const links = row.organization_id ? parseLinksJson(row.organization_links_json) : userLinks;

  return {
    ...summary,
    content: row.content_markdown ?? null,
    blogUrl: sanitizeLegacyHttpUrl(row.blog_url),
    blogFeedUrl: sanitizeLegacyHttpUrl(row.blog_feed_url),
    pressUrl: sanitizeLegacyHttpUrl(row.press_url),
    pressFeedUrl: sanitizeLegacyHttpUrl(row.press_feed_url),
    careersUrl: sanitizeLegacyHttpUrl(row.careers_url),
    links,
    identities,
    jobTitle: row.organization_id ? null : row.job_title,
    featuredLink: getFeaturedLink(links),
  };
}

/**
 * `id` matches the directory `id` field for organizations and org-less
 * individuals (H5/H6/H7) — see `toSummary` — but is also called with a
 * identity's own id (see `toPublicIdentity`'s `photoUrl`), since an
 * organization identity has no organization logo row of its own. In every
 * non-organization case the photo lives on `users.headshot_r2_key`.
 */
export async function getMemberLogoR2Key(db: DatabaseLike, id: string): Promise<string | null> {
  // Each branch is a primary-key lookup. Preserve entity precedence even when
  // its image is null, without three sequential D1 round trips for identities.
  const row = await first<{ image_key: string | null }>(
    db,
    `SELECT logo_r2_key AS image_key, 0 AS priority FROM organizations WHERE id = ?
     UNION ALL
     SELECT u.headshot_r2_key AS image_key, 1 AS priority
     FROM members m
     JOIN users u ON u.id = m.user_id
     WHERE m.id = ?
     UNION ALL
     SELECT u.headshot_r2_key AS image_key, 2 AS priority
     FROM identities identity
     JOIN users u ON u.id = identity.user_id
     WHERE identity.id = ?
     ORDER BY priority LIMIT 1`,
    [id, id, id],
  );
  return row?.image_key ?? null;
}

// ── Working groups ──────────────────────────────────────────────────────────
