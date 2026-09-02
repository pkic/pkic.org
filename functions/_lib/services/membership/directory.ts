import { all, first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
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
 * view's identity roster (see `loadPublicIdentities`).
 */

interface OrgDataJson {
  website?: string;
  description?: string;
  logoUrl?: string;
  slogan?: string;
}

export interface PublicMemberIdentity {
  name: string;
  jobTitle: string | null;
  bio: string | null;
  featuredLink: string | null;
  photoUrl: string | null;
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

const DIRECTORY_SELECT = `
  SELECT m.id AS member_id, m.organization_id, o.slug AS org_slug, o.name AS org_name, o.data_json AS org_data_json,
         o.description AS org_description, o.website AS org_website, o.slogan AS org_slogan,
         o.logo_r2_key AS org_logo_r2_key,
         u.first_name, u.last_name,
         CASE WHEN m.organization_id IS NULL THEN mc.label ELSE NULL END AS job_title,
         individual_identity.biography, individual_identity.links_json, u.headshot_r2_key,
         mca.category_code, m.tier, m.member_since, m.created_at
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

async function loadPublicIdentities(db: DatabaseLike, organizationId: string): Promise<PublicMemberIdentity[]> {
  const rows = await all<{
    identity_id: string;
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    job_title: string | null;
    biography: string | null;
    links_json: string | null;
    headshot_r2_key: string | null;
  }>(
    db,
    `SELECT identity.id AS identity_id, u.id AS user_id, u.first_name, u.last_name,
            identity.job_title, identity.biography, identity.links_json, u.headshot_r2_key
     FROM identities identity
     JOIN users u ON u.id = identity.user_id
     WHERE identity.organization_id = ?
       AND identity.started_at IS NOT NULL
       AND identity.ended_at IS NULL
       AND identity.blocked_at IS NULL
       AND identity.show_on_organization_profile = 1
     ORDER BY u.last_name ASC, u.first_name ASC`,
    [organizationId],
  );

  return rows.map((r) => ({
    name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unknown",
    jobTitle: r.job_title,
    bio: r.biography,
    featuredLink: getFeaturedLink(parseLinksJson(r.links_json)),
    photoUrl: r.headshot_r2_key ? `/api/v1/members/${r.identity_id}/logo` : null,
  }));
}

/** `idOrSlug` resolves against an organization's UUID primary key, its clean
 * URL slug (organizations.slug, consolidated migration 0035), or — for org-less
 * individuals, which have no organizations row — the member's own id. */
export async function getPublicMemberById(db: DatabaseLike, idOrSlug: string): Promise<PublicMemberDetail | null> {
  const row = await first<DirectoryRow>(
    db,
    `${DIRECTORY_SELECT} AND (m.organization_id = ? OR o.slug = ? OR (m.organization_id IS NULL AND m.id = ?)) LIMIT 1`,
    [idOrSlug, idOrSlug, idOrSlug],
  );
  if (!row) return null;

  const summary = toSummary(row);
  const userLinks = parseLinksJson(row.links_json);
  const identities = row.organization_id ? await loadPublicIdentities(db, row.organization_id) : [];

  const orgRow = row.organization_id
    ? await first<{
        content_markdown: string | null;
        blog_url: string | null;
        blog_feed_url: string | null;
        press_url: string | null;
        press_feed_url: string | null;
        careers_url: string | null;
        links_json: string | null;
      }>(
        db,
        `SELECT content_markdown, blog_url, blog_feed_url, press_url, press_feed_url, careers_url, links_json
         FROM organizations WHERE id = ?`,
        [row.organization_id],
      )
    : null;

  // An organization's public links belong to the organization row; an org-less
  // individual's belong to their own user record.
  const links = row.organization_id ? parseLinksJson(orgRow?.links_json ?? null) : userLinks;

  return {
    ...summary,
    content: orgRow?.content_markdown ?? null,
    blogUrl: sanitizeLegacyHttpUrl(orgRow?.blog_url),
    blogFeedUrl: sanitizeLegacyHttpUrl(orgRow?.blog_feed_url),
    pressUrl: sanitizeLegacyHttpUrl(orgRow?.press_url),
    pressFeedUrl: sanitizeLegacyHttpUrl(orgRow?.press_feed_url),
    careersUrl: sanitizeLegacyHttpUrl(orgRow?.careers_url),
    links,
    identities,
    jobTitle: row.organization_id ? null : row.job_title,
    featuredLink: getFeaturedLink(links),
  };
}

/**
 * `id` matches the directory `id` field for organizations and org-less
 * individuals (H5/H6/H7) — see `toSummary` — but is also called with a
 * identity's own id (see `loadPublicIdentities`'s `photoUrl`), since an
 * organization identity has no organization logo row of its own. In every
 * non-organization case the photo lives on `users.headshot_r2_key`.
 */
export async function getMemberLogoR2Key(db: DatabaseLike, id: string): Promise<string | null> {
  const orgRow = await first<{ logo_r2_key: string | null }>(db, `SELECT logo_r2_key FROM organizations WHERE id = ?`, [
    id,
  ]);
  if (orgRow) return orgRow.logo_r2_key ?? null;

  const individualRow = await first<{ headshot_r2_key: string | null }>(
    db,
    `SELECT u.headshot_r2_key AS headshot_r2_key
     FROM members m
     JOIN users u ON u.id = m.user_id
     WHERE m.id = ?`,
    [id],
  );
  if (individualRow) return individualRow.headshot_r2_key ?? null;

  const identityRow = await first<{ headshot_r2_key: string | null }>(
    db,
    `SELECT u.headshot_r2_key AS headshot_r2_key
     FROM identities identity
     JOIN users u ON u.id = identity.user_id
     WHERE identity.id = ?`,
    [id],
  );
  return identityRow?.headshot_r2_key ?? null;
}

// ── Working groups ──────────────────────────────────────────────────────────
