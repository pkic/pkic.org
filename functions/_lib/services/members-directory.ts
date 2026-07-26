import { all, first } from "../db/queries";
import { parseJsonSafe } from "../utils/json";
import type { DatabaseLike } from "../types";

/**
 * Public member directory (PRD §1.5/§1.6). D1 is the source of truth going
 * forward, replacing data/members/*.yaml — but since no code path creates
 * `members`/`organizations` rows yet (Phase 4A onboarding), these queries
 * will return an empty directory until then. That's expected: Phase 1 ships
 * the read API; Phase 4A is what populates it.
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

export interface PublicMemberSummary {
  id: string;
  name: string;
  memberType: string;
  tier: string | null;
  website: string | null;
  description: string | null;
  logoUrl: string | null;
  memberSince: string;
}

interface DirectoryRow {
  member_id: string;
  organization_id: string | null;
  org_name: string | null;
  org_data_json: string | null;
  first_name: string | null;
  last_name: string | null;
  member_type: string;
  tier: string | null;
  created_at: string;
}

function toSummary(row: DirectoryRow): PublicMemberSummary {
  const orgData = parseJsonSafe<OrgDataJson>(row.org_data_json, {});
  const name = row.organization_id
    ? (row.org_name ?? "Unknown organization")
    : [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown member";

  return {
    id: row.organization_id ?? row.member_id,
    name,
    memberType: row.member_type,
    tier: row.tier,
    website: orgData.website ?? null,
    description: orgData.description ?? null,
    logoUrl: orgData.logoUrl ?? null,
    memberSince: row.created_at,
  };
}

const DIRECTORY_SELECT = `
  SELECT m.id AS member_id, m.organization_id, o.name AS org_name, o.data_json AS org_data_json,
         u.first_name, u.last_name, m.member_type, m.tier, m.created_at
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

export async function listPublicMembers(
  db: DatabaseLike,
  params: { limit: number; offset: number },
): Promise<{ members: PublicMemberSummary[]; total: number }> {
  const [rows, totalRow] = await Promise.all([
    all<DirectoryRow>(
      db,
      `${DIRECTORY_SELECT} ORDER BY COALESCE(o.name, u.last_name, u.first_name) ASC LIMIT ? OFFSET ?`,
      [params.limit, params.offset],
    ),
    first<{ total: number }>(db, `SELECT COUNT(*) AS total FROM (${DIRECTORY_SELECT})`),
  ]);

  return { members: rows.map(toSummary), total: totalRow?.total ?? 0 };
}

export async function getPublicMemberById(db: DatabaseLike, id: string): Promise<PublicMemberSummary | null> {
  const row = await first<DirectoryRow>(
    db,
    `${DIRECTORY_SELECT} AND (m.organization_id = ? OR (m.organization_id IS NULL AND m.id = ?)) LIMIT 1`,
    [id, id],
  );
  return row ? toSummary(row) : null;
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

export interface WorkingGroupDetail extends WorkingGroupSummary {
  mailingListEmail: string | null;
  members: WorkingGroupMemberPublic[];
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

  return {
    id: wg.id,
    name: wg.name,
    slug: wg.slug,
    description: wg.description,
    active: wg.active === 1,
    mailingListEmail: wg.mailing_list_email,
    members: members.map((m) => ({
      name: [m.first_name, m.last_name].filter(Boolean).join(" ") || "Unknown",
      organizationName: m.org_name,
    })),
  };
}
