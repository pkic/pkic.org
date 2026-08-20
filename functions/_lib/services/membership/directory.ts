import { all, first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { parseJsonSafe } from "../../utils/json";
import { parseLinksJson, findLinkedinUrl } from "../../../../assets/shared/schemas/links";
import { deterministicRepresentativeJoinSql } from "./representative-lookup";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import type { PublicMemberDetail, PublicMemberSummary } from "../../../../assets/shared/schemas/members-directory";

/**
 * Public member directory. D1 is the source of truth,
 * populated from data/members/*.yaml by scripts/migrate-members-yaml-to-d1.mjs.
 * Most content fields (description/website/slogan/content/blog/
 * press/careers/social) live on the real `organizations` columns added in
 * migration 0037 — `data_json` predates that migration and is nothing writes
 * to it anymore, but it's kept as a fallback source for any row that only
 * has it set (e.g. rows seeded directly in tests).
 *
 * Design note: `members` holds exactly one aggregate row per organization
 * (migration 0000/0037) — a public directory entry is one row per
 * *organization* (or one row per individual, org-less member), with N
 * `organization_representatives` rows resolved separately for the detail
 * view's representative roster (see `loadRepresentatives`).
 */

interface OrgDataJson {
  website?: string;
  description?: string;
  logoUrl?: string;
  slogan?: string;
}

export interface PublicMemberRepresentative {
  name: string;
  jobTitle: string | null;
  bio: string | null;
  linkedin: string | null;
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
      : (orgData.logoUrl ?? null)
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
    website: row.org_website ?? orgData.website ?? null,
    description: row.org_description ?? orgData.description ?? (isIndividual ? row.biography : null) ?? null,
    slogan: row.org_slogan ?? orgData.slogan ?? null,
    logoUrl,
    // Falls back to the row's creation time for records that predate
    // migration 0049 (or a creation path that didn't supply a real one).
    memberSince: row.member_since ?? row.created_at,
  };
}

const DIRECTORY_SELECT = `
  SELECT m.id AS member_id, m.organization_id, o.slug AS org_slug, o.name AS org_name, o.data_json AS org_data_json,
         o.description AS org_description, o.website AS org_website, o.slogan AS org_slogan,
         o.logo_r2_key AS org_logo_r2_key,
         u.first_name, u.last_name, u.job_title, u.biography, u.links_json, u.headshot_r2_key,
         mca.category_code, m.tier, m.member_since, m.created_at
  FROM members m
  LEFT JOIN organizations o ON o.id = m.organization_id
  LEFT JOIN users u ON u.id = m.user_id
  JOIN member_category_assignments mca ON mca.member_id = m.id
  WHERE m.status = 'active'
`;

/** group: "organization" = org-tied categories; "independent" = org-less H5/H6/H7 */
export async function listPublicMembers(
  db: DatabaseLike,
  params: {
    limit: number;
    offset: number;
    q?: string;
    sort?: string;
    group?: "all" | "organization" | "independent";
  },
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

  const { rows, total } = await queryPage<DirectoryRow>(
    db,
    {
      sql: `${DIRECTORY_SELECT}${extraWhere} ${orderBy} LIMIT ? OFFSET ?`,
      bindings: [...args, params.limit, params.offset],
    },
    { sql: `SELECT COUNT(*) AS total FROM (${DIRECTORY_SELECT}${extraWhere})`, bindings: args },
  );

  return { members: rows.map(toSummary), total };
}

async function loadRepresentatives(db: DatabaseLike, organizationId: string): Promise<PublicMemberRepresentative[]> {
  const rows = await all<{
    representative_id: string;
    first_name: string | null;
    last_name: string | null;
    job_title: string | null;
    biography: string | null;
    links_json: string | null;
    headshot_r2_key: string | null;
  }>(
    db,
    `SELECT r.id AS representative_id, u.first_name, u.last_name, u.job_title, u.biography, u.links_json, u.headshot_r2_key
     FROM organization_representatives r
     JOIN members m ON m.id = r.member_id
     JOIN users u ON u.id = r.user_id
     WHERE m.organization_id = ? AND r.left_at IS NULL AND r.show_on_org_profile = 1
     ORDER BY u.last_name ASC, u.first_name ASC`,
    [organizationId],
  );

  return rows.map((r) => ({
    name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unknown",
    jobTitle: r.job_title,
    bio: r.biography,
    linkedin: findLinkedinUrl(parseLinksJson(r.links_json)),
    photoUrl: r.headshot_r2_key ? `/api/v1/members/${r.representative_id}/logo` : null,
  }));
}

/** `idOrSlug` resolves against an organization's UUID primary key, its clean
 * URL slug (organizations.slug, migration 0047), or — for org-less
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
  const representatives = row.organization_id ? await loadRepresentatives(db, row.organization_id) : [];

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

  return {
    ...summary,
    content: orgRow?.content_markdown ?? null,
    blogUrl: orgRow?.blog_url ?? null,
    blogFeedUrl: orgRow?.blog_feed_url ?? null,
    pressUrl: orgRow?.press_url ?? null,
    pressFeedUrl: orgRow?.press_feed_url ?? null,
    careersUrl: orgRow?.careers_url ?? null,
    links: row.organization_id ? parseLinksJson(orgRow?.links_json ?? null) : userLinks,
    representatives,
    jobTitle: row.organization_id ? null : row.job_title,
    linkedin: row.organization_id ? null : findLinkedinUrl(userLinks),
  };
}

/**
 * `id` matches the directory `id` field for organizations and org-less
 * individuals (H5/H6/H7) — see `toSummary` — but is also called with a
 * representative's own `organization_representatives.id` (see
 * `loadRepresentatives`'s `photoUrl`), since an org-tied representative has
 * no `organizations` row of their own to key a logo off of. In every
 * non-organization case the photo lives on `users.headshot_r2_key` (the
 * same column self-service headshot uploads use).
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

  const representativeRow = await first<{ headshot_r2_key: string | null }>(
    db,
    `SELECT u.headshot_r2_key AS headshot_r2_key
     FROM organization_representatives r
     JOIN users u ON u.id = r.user_id
     WHERE r.id = ?`,
    [id],
  );
  return representativeRow?.headshot_r2_key ?? null;
}

// ── Working groups ──────────────────────────────────────────────────────────

export interface WorkingGroupSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  active: boolean;
}

export interface WorkingGroupMemberPublic {
  name: string;
  organizationName: string | null;
}

export interface WorkingGroupChairPublic {
  name: string;
  organizationName: string | null;
  organizationLogoUrl: string | null;
  organizationWebsite: string | null;
  photoUrl: string | null;
  linkedin: string | null;
}

export interface WorkingGroupDetail extends WorkingGroupSummary {
  mailingListEmail: string | null;
  members: WorkingGroupMemberPublic[];
  chair: WorkingGroupChairPublic | null;
  viceChair: WorkingGroupChairPublic | null;
}

interface WorkingGroupRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  mailing_list_email: string | null;
  active: number;
}

export async function listWorkingGroups(db: DatabaseLike): Promise<WorkingGroupSummary[]> {
  const rows = await all<WorkingGroupRow>(
    db,
    `SELECT id, name, slug, description, mailing_list_email, active FROM working_groups WHERE active = 1 ORDER BY name ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    active: r.active === 1,
  }));
}

// Chairs are resolved from user_roles (role-wg_chair/role-wg_vice_chair,
// context_type='working_group'), the same live source admin-working-groups.ts
// reads — not the dead working_groups.chair_user_id column, and not the
// static content/wg/*/_index.md `chair:`/`viceChair:` frontmatter this
// replaces so staff no longer need a git commit to update a WG's public
// chair listing. No email (matching this endpoint's existing "public subset"
// convention for the member roster), but photo/LinkedIn/org-logo are public
// by nature (same assets the member directory already serves publicly via
// GET /api/v1/members/:id/logo — getMemberLogoR2Key resolves both an
// organization id and a members.id, so the URLs below reuse that endpoint
// as-is).
async function getWorkingGroupChairsPublic(
  db: DatabaseLike,
  wgId: string,
): Promise<{ chair: WorkingGroupChairPublic | null; viceChair: WorkingGroupChairPublic | null }> {
  const rows = await all<{
    role_id: string;
    first_name: string | null;
    last_name: string | null;
    org_id: string | null;
    org_name: string | null;
    org_logo_r2_key: string | null;
    org_website: string | null;
    member_id: string | null;
    headshot_r2_key: string | null;
    links_json: string | null;
  }>(
    db,
    `SELECT ur.role_id, u.first_name, u.last_name, o.id AS org_id, o.name AS org_name,
            o.logo_r2_key AS org_logo_r2_key, o.website AS org_website,
            COALESCE(rep.id, mi.id) AS member_id, u.headshot_r2_key, u.links_json
     FROM user_roles ur
     JOIN users u ON u.id = ur.user_id
     -- A chair/vice-chair can represent more than one organization at once
     -- (migration 0037) — join to a single deterministic representative
     -- row (earliest joined_at) instead of fanning out one result row per
     -- represented organization.
${deterministicRepresentativeJoinSql("u.id")}
     LEFT JOIN members m ON m.id = rep.member_id
     LEFT JOIN members mi ON mi.user_id = u.id AND mi.status = 'active'
     LEFT JOIN organizations o ON o.id = m.organization_id
     WHERE ur.context_type = 'working_group' AND ur.context_id = ?
       AND ur.role_id IN ('role-wg_chair', 'role-wg_vice_chair')
       AND ur.revoked_at IS NULL
       AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ORDER BY ur.created_at DESC`,
    [wgId],
  );

  const toPublic = (row: (typeof rows)[number] | undefined): WorkingGroupChairPublic | null => {
    if (!row) return null;
    return {
      name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown",
      organizationName: row.org_name,
      organizationLogoUrl: row.org_logo_r2_key && row.org_id ? `/api/v1/members/${row.org_id}/logo` : null,
      organizationWebsite: row.org_website,
      // member_id here is either an organization_representatives.id (org-tied
      // chair) or an individual members.id — both resolve via getMemberLogoR2Key.
      photoUrl: row.headshot_r2_key && row.member_id ? `/api/v1/members/${row.member_id}/logo` : null,
      linkedin: findLinkedinUrl(parseLinksJson(row.links_json)),
    };
  };

  return {
    chair: toPublic(rows.find((r) => r.role_id === "role-wg_chair")),
    viceChair: toPublic(rows.find((r) => r.role_id === "role-wg_vice_chair")),
  };
}

export async function getWorkingGroupByIdOrSlug(
  db: DatabaseLike,
  idOrSlug: string,
): Promise<WorkingGroupDetail | null> {
  const wg = await first<WorkingGroupRow>(
    db,
    `SELECT id, name, slug, description, mailing_list_email, active FROM working_groups WHERE id = ? OR slug = ? LIMIT 1`,
    [idOrSlug, idOrSlug],
  );
  if (!wg) return null;

  const members = await all<{ first_name: string | null; last_name: string | null; org_name: string | null }>(
    db,
    `SELECT u.first_name, u.last_name, o.name AS org_name
     FROM working_group_members wgm
     JOIN users u ON u.id = wgm.user_id
     -- A WG member can represent more than one organization at once
     -- (migration 0037) — join to a single deterministic representative
     -- row (earliest joined_at) instead of fanning out one result row per
     -- represented organization.
${deterministicRepresentativeJoinSql("wgm.user_id")}
     LEFT JOIN members m ON m.id = rep.member_id
     LEFT JOIN organizations o ON o.id = m.organization_id
     WHERE wgm.working_group_id = ? AND wgm.left_at IS NULL
     ORDER BY u.last_name ASC, u.first_name ASC`,
    [wg.id],
  );

  const { chair, viceChair } = await getWorkingGroupChairsPublic(db, wg.id);

  return {
    id: wg.id,
    name: wg.name,
    slug: wg.slug,
    description: wg.description,
    active: wg.active === 1,
    mailingListEmail: wg.mailing_list_email,
    chair,
    viceChair,
    members: members.map((m) => ({
      name: [m.first_name, m.last_name].filter(Boolean).join(" ") || "Unknown",
      organizationName: m.org_name,
    })),
  };
}
