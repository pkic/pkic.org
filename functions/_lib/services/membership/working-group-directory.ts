import { all, first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { deterministicRepresentativeJoinSql } from "./representative-lookup";
import { toPublicRoleProfile, type PublicRoleProfile, type PublicRoleProfileRow } from "./public-role-profile";

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

export type WorkingGroupChairPublic = PublicRoleProfile;

export interface WorkingGroupDetail extends WorkingGroupSummary {
  mailingListEmail: string | null;
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

interface WorkingGroupMemberRow {
  first_name: string | null;
  last_name: string | null;
  org_name: string | null;
}

const WORKING_GROUP_SELECT = "SELECT id, name, slug, description, mailing_list_email, active FROM working_groups";

async function getActiveWorkingGroupRow(db: DatabaseLike, idOrSlug: string): Promise<WorkingGroupRow | null> {
  return first<WorkingGroupRow>(db, `${WORKING_GROUP_SELECT} WHERE (id = ? OR slug = ?) AND active = 1 LIMIT 1`, [
    idOrSlug,
    idOrSlug,
  ]);
}

export async function listWorkingGroups(db: DatabaseLike): Promise<WorkingGroupSummary[]> {
  const rows = await all<WorkingGroupRow>(db, `${WORKING_GROUP_SELECT} WHERE active = 1 ORDER BY name ASC, id ASC`);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    active: row.active === 1,
  }));
}

async function getWorkingGroupChairsPublic(
  db: DatabaseLike,
  workingGroupId: string,
): Promise<{ chair: WorkingGroupChairPublic | null; viceChair: WorkingGroupChairPublic | null }> {
  const rows = await all<
    PublicRoleProfileRow & {
      role_id: string;
    }
  >(
    db,
    `SELECT ur.role_id, u.first_name, u.last_name, o.id AS org_id, o.name AS org_name,
            o.logo_r2_key AS org_logo_r2_key, o.website AS org_website,
            COALESCE(rep.id, mi.id) AS member_id, u.headshot_r2_key, u.links_json
     FROM user_roles ur
     JOIN users u ON u.id = ur.user_id
${deterministicRepresentativeJoinSql("u.id")}
     LEFT JOIN members m ON m.id = rep.member_id
     LEFT JOIN members mi ON mi.user_id = u.id AND mi.status = 'active'
     LEFT JOIN organizations o ON o.id = m.organization_id
     WHERE ur.context_type = 'working_group' AND ur.context_id = ?
       AND ur.role_id IN ('role-wg_chair', 'role-wg_vice_chair')
       AND ur.revoked_at IS NULL
       AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ORDER BY ur.created_at DESC`,
    [workingGroupId],
  );

  const toPublic = (row: (typeof rows)[number] | undefined): WorkingGroupChairPublic | null => {
    if (!row) return null;
    return toPublicRoleProfile(row);
  };

  return {
    chair: toPublic(rows.find((row) => row.role_id === "role-wg_chair")),
    viceChair: toPublic(rows.find((row) => row.role_id === "role-wg_vice_chair")),
  };
}

export async function getWorkingGroupByIdOrSlug(
  db: DatabaseLike,
  idOrSlug: string,
): Promise<WorkingGroupDetail | null> {
  const row = await getActiveWorkingGroupRow(db, idOrSlug);
  if (!row) return null;
  const { chair, viceChair } = await getWorkingGroupChairsPublic(db, row.id);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    active: row.active === 1,
    mailingListEmail: row.mailing_list_email,
    chair,
    viceChair,
  };
}

export async function listWorkingGroupMembers(
  db: DatabaseLike,
  idOrSlug: string,
  params: { q?: string; sort?: string; limit: number; offset: number },
): Promise<{ members: WorkingGroupMemberPublic[]; total: number } | null> {
  const workingGroup = await getActiveWorkingGroupRow(db, idOrSlug);
  if (!workingGroup) return null;

  const search = params.q
    ? buildD1TextSearchFilter(params.q, ["u.first_name", "u.last_name", "u.first_name || ' ' || u.last_name", "o.name"])
    : null;
  const where = search ? ` AND ${search.sql}` : "";
  const bindings = [workingGroup.id, ...(search?.bindings ?? [])];
  const from = `FROM working_group_members wgm
     JOIN users u ON u.id = wgm.user_id
${deterministicRepresentativeJoinSql("wgm.user_id")}
     LEFT JOIN members m ON m.id = rep.member_id
     LEFT JOIN organizations o ON o.id = m.organization_id
     WHERE wgm.working_group_id = ? AND wgm.left_at IS NULL${where}`;
  const orderBy = resolveMappedOrderBy(
    params.sort,
    { name: "COALESCE(u.last_name, u.first_name)", organizationName: "o.name" },
    "COALESCE(u.last_name, u.first_name) COLLATE NOCASE ASC",
    "u.id ASC",
  );
  const result = await queryPage<WorkingGroupMemberRow>(
    db,
    {
      sql: `SELECT u.first_name, u.last_name, o.name AS org_name ${from} ${orderBy} LIMIT ? OFFSET ?`,
      bindings: [...bindings, params.limit, params.offset],
    },
    { sql: `SELECT COUNT(*) AS total ${from}`, bindings },
  );
  return {
    members: result.rows.map((row) => ({
      name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown",
      organizationName: row.org_name,
    })),
    total: result.total,
  };
}
