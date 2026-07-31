import { all, first } from "../db/queries";
import { parseJsonSafe } from "../utils/json";
import type { DatabaseLike } from "../types";

/**
 * Public member directory (PRD §1.5/§1.6). D1 is the source of truth,
 * populated from data/members/*.yaml by scripts/migrate-members-yaml-to-d1.mjs
 * (§6 Step 2). Most content fields (description/website/slogan/content/blog/
 * press/careers/social) live on the real `organizations` columns added in
 * migration 0037 — `data_json` predates that migration and is nothing writes
 * to it anymore, but it's kept as a fallback source for any row that only
 * has it set (e.g. rows seeded directly in tests).
 *
 * Design note: `members` now allows multiple rows per organization_id (one
 * per representative, migration 0033). A public directory entry is one row
 * per *organization* (or one row per individual, org-less member) — so for
 * org-tied members we surface only the earliest-created ("primary contact")
 * row per organization_id as that organization's directory entry.
 */

interface OrgDataJson {
  website?: string;
  description?: string;
  logoUrl?: string;
  slogan?: string;
}

interface UserLinksJson {
  linkedin?: string;
  x?: string;
}

export interface PublicMemberSummary {
  id: string;
  slug: string | null;
  name: string;
  memberType: string;
  tier: string | null;
  website: string | null;
  description: string | null;
  slogan: string | null;
  logoUrl: string | null;
  memberSince: string;
}

export interface PublicMemberRepresentative {
  name: string;
  jobTitle: string | null;
  bio: string | null;
  linkedin: string | null;
  photoUrl: string | null;
}

export interface PublicMemberDetail extends PublicMemberSummary {
  content: string | null;
  blogUrl: string | null;
  blogFeedUrl: string | null;
  pressUrl: string | null;
  pressFeedUrl: string | null;
  careersUrl: string | null;
  social: {
    x: string | null;
    linkedin: string | null;
    facebook: string | null;
    instagram: string | null;
    youtube: string | null;
  };
  representatives: PublicMemberRepresentative[];
  jobTitle: string | null;
  linkedin: string | null;
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
  org_member_since: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  headshot_r2_key: string | null;
  member_type: string;
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
    memberType: row.member_type,
    tier: row.tier,
    website: row.org_website ?? orgData.website ?? null,
    description: row.org_description ?? orgData.description ?? (isIndividual ? row.biography : null) ?? null,
    slogan: row.org_slogan ?? orgData.slogan ?? null,
    logoUrl,
    // Org-tied members share the organization's own join date; org-less
    // individuals carry their own on the members row. Both fall back to the
    // row's creation time for records that predate migration 0046 (or a
    // creation path that didn't supply a real one).
    memberSince: (row.organization_id ? row.org_member_since : row.member_since) ?? row.created_at,
  };
}

const DIRECTORY_SELECT = `
  SELECT m.id AS member_id, m.organization_id, o.slug AS org_slug, o.name AS org_name, o.data_json AS org_data_json,
         o.description AS org_description, o.website AS org_website, o.slogan AS org_slogan,
         o.logo_r2_key AS org_logo_r2_key, o.member_since AS org_member_since,
         u.first_name, u.last_name, u.job_title, u.biography, u.links_json, u.headshot_r2_key,
         m.member_type, m.tier, m.member_since, m.created_at
  FROM members m
  LEFT JOIN organizations o ON o.id = m.organization_id
  LEFT JOIN users u ON u.id = m.user_id
  WHERE m.status = 'active'
    AND (
      m.organization_id IS NULL
      OR m.id = (
        SELECT m2.id FROM members m2
        WHERE m2.organization_id = m.organization_id AND m2.status = 'active'
        ORDER BY m2.created_at ASC, m2.id ASC
        LIMIT 1
      )
    )
`;

/** group: "organization" = org-tied categories; "independent" = org-less H5/H6/H7 */
export async function listPublicMembers(
  db: DatabaseLike,
  params: { limit: number; offset: number; q?: string; group?: "all" | "organization" | "independent" },
): Promise<{ members: PublicMemberSummary[]; total: number }> {
  const conditions: string[] = [];
  const args: unknown[] = [];

  if (params.group === "independent") {
    conditions.push("m.organization_id IS NULL");
  } else if (params.group === "organization") {
    conditions.push("m.organization_id IS NOT NULL");
  }

  if (params.q) {
    conditions.push("COALESCE(o.name, u.first_name || ' ' || u.last_name, '') LIKE ? ESCAPE '\\'");
    const escaped = params.q.replace(/[\\%_]/g, (c) => `\\${c}`);
    args.push(`%${escaped}%`);
  }

  const extraWhere = conditions.length ? ` AND ${conditions.join(" AND ")}` : "";

  const [rows, totalRow] = await Promise.all([
    all<DirectoryRow>(
      db,
      `${DIRECTORY_SELECT}${extraWhere} ORDER BY COALESCE(o.name, u.last_name, u.first_name) ASC LIMIT ? OFFSET ?`,
      [...args, params.limit, params.offset],
    ),
    first<{ total: number }>(db, `SELECT COUNT(*) AS total FROM (${DIRECTORY_SELECT}${extraWhere})`, args),
  ]);

  return { members: rows.map(toSummary), total: totalRow?.total ?? 0 };
}

async function loadRepresentatives(db: DatabaseLike, organizationId: string): Promise<PublicMemberRepresentative[]> {
  const rows = await all<{
    member_id: string;
    first_name: string | null;
    last_name: string | null;
    job_title: string | null;
    biography: string | null;
    links_json: string | null;
    headshot_r2_key: string | null;
  }>(
    db,
    `SELECT m.id AS member_id, u.first_name, u.last_name, u.job_title, u.biography, u.links_json, u.headshot_r2_key
     FROM members m
     JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = ? AND m.status = 'active' AND m.show_on_org_profile = 1
     ORDER BY u.last_name ASC, u.first_name ASC`,
    [organizationId],
  );

  return rows.map((r) => {
    const links = parseJsonSafe<UserLinksJson>(r.links_json, {});
    return {
      name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unknown",
      jobTitle: r.job_title,
      bio: r.biography,
      linkedin: links.linkedin ?? null,
      photoUrl: r.headshot_r2_key ? `/api/v1/members/${r.member_id}/logo` : null,
    };
  });
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
  const links = parseJsonSafe<UserLinksJson>(row.links_json, {});
  const representatives = row.organization_id ? await loadRepresentatives(db, row.organization_id) : [];

  const orgRow = row.organization_id
    ? await first<{
        content_markdown: string | null;
        blog_url: string | null;
        blog_feed_url: string | null;
        press_url: string | null;
        press_feed_url: string | null;
        careers_url: string | null;
        social_x: string | null;
        social_linkedin: string | null;
        social_facebook: string | null;
        social_instagram: string | null;
        social_youtube: string | null;
      }>(
        db,
        `SELECT content_markdown, blog_url, blog_feed_url, press_url, press_feed_url, careers_url,
                social_x, social_linkedin, social_facebook, social_instagram, social_youtube
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
    social: {
      x: orgRow?.social_x ?? null,
      linkedin: orgRow?.social_linkedin ?? null,
      facebook: orgRow?.social_facebook ?? null,
      instagram: orgRow?.social_instagram ?? null,
      youtube: orgRow?.social_youtube ?? null,
    },
    representatives,
    jobTitle: row.organization_id ? null : row.job_title,
    linkedin: row.organization_id ? null : (links.linkedin ?? null),
  };
}

/**
 * `id` matches the directory `id` field for organizations and org-less
 * individuals (H5/H6/H7) — see `toSummary` — but is also called with a
 * representative's own `members.id` (see `loadRepresentatives`'s
 * `photoUrl`), since an org-tied representative has no `organizations` row
 * of their own to key a logo off of. In every non-organization case the
 * photo lives on `users.headshot_r2_key` (the same column self-service
 * headshot uploads use), so the second query intentionally has no
 * `organization_id IS NULL` restriction — it resolves individuals and
 * representatives alike.
 */
export async function getMemberLogoR2Key(db: DatabaseLike, id: string): Promise<string | null> {
  const orgRow = await first<{ logo_r2_key: string | null }>(db, `SELECT logo_r2_key FROM organizations WHERE id = ?`, [
    id,
  ]);
  if (orgRow) return orgRow.logo_r2_key ?? null;

  const memberRow = await first<{ headshot_r2_key: string | null }>(
    db,
    `SELECT u.headshot_r2_key AS headshot_r2_key
     FROM members m
     JOIN users u ON u.id = m.user_id
     WHERE m.id = ?`,
    [id],
  );
  return memberRow?.headshot_r2_key ?? null;
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
// chair listing. Name + organization only (no email) to match this
// endpoint's existing "public subset" convention for the member roster.
async function getWorkingGroupChairsPublic(
  db: DatabaseLike,
  wgId: string,
): Promise<{ chair: WorkingGroupChairPublic | null; viceChair: WorkingGroupChairPublic | null }> {
  const rows = await all<{
    role_id: string;
    first_name: string | null;
    last_name: string | null;
    org_name: string | null;
  }>(
    db,
    `SELECT ur.role_id, u.first_name, u.last_name, o.name AS org_name
     FROM user_roles ur
     JOIN users u ON u.id = ur.user_id
     LEFT JOIN members m ON m.user_id = u.id AND m.status = 'active'
     LEFT JOIN organizations o ON o.id = m.organization_id
     WHERE ur.context_type = 'working_group' AND ur.context_id = ?
       AND ur.role_id IN ('role-wg_chair', 'role-wg_vice_chair')
       AND ur.revoked_at IS NULL
       AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ORDER BY ur.created_at DESC`,
    [wgId],
  );

  const toPublic = (row: (typeof rows)[number] | undefined): WorkingGroupChairPublic | null =>
    row
      ? {
          name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown",
          organizationName: row.org_name,
        }
      : null;

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
     LEFT JOIN members m ON m.user_id = wgm.user_id AND m.status = 'active'
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
