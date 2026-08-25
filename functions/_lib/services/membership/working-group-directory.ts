import { all, first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { GROUP_DEPUTY_LEAD_ROLE_ID, GROUP_LEAD_ROLE_ID } from "../group-leadership-query";
import { getVisibleGroup, listGroups } from "../groups/read-model";
import { deterministicRepresentativeJoinSql } from "./representative-lookup";
import { toPublicRoleProfile, type PublicRoleProfile, type PublicRoleProfileRow } from "./public-role-profile";
import type {
  PublicWorkingGroupMembersListQuery,
  PublicWorkingGroupsListQuery,
} from "../../../../assets/shared/schemas/members-directory";

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

interface WorkingGroupMemberRow {
  first_name: string | null;
  last_name: string | null;
  org_name: string | null;
}

async function getPublicWorkingGroup(db: DatabaseLike, idOrSlug: string) {
  const group = await getVisibleGroup(db, idOrSlug, {});
  return group?.type.key === "working_group" ? group : null;
}

export async function listWorkingGroups(
  db: DatabaseLike,
  params: PublicWorkingGroupsListQuery,
): Promise<{ workingGroups: WorkingGroupSummary[]; total: number }> {
  const result = await listGroups(db, {
    ...params,
    active: true,
    typeKey: "working_group",
    visibility: "public",
  });
  return {
    workingGroups: result.groups.map((group) => ({
      id: group.id,
      name: group.name,
      slug: group.slug,
      description: group.description,
      active: group.active,
    })),
    total: result.total,
  };
}

async function getWorkingGroupChairsPublic(
  db: DatabaseLike,
  workingGroupSlug: string,
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
     JOIN groups leadership_group
       ON leadership_group.id = ur.context_id
      AND leadership_group.slug = ?
      AND leadership_group.active = 1
      AND leadership_group.public_leadership = 1
${deterministicRepresentativeJoinSql("u.id")}
     LEFT JOIN members m ON m.id = rep.member_id
     LEFT JOIN members mi ON mi.user_id = u.id AND mi.status = 'active'
     LEFT JOIN organizations o ON o.id = m.organization_id
     WHERE ur.context_type = 'group'
       AND ur.role_id IN (?, ?)
       AND ur.revoked_at IS NULL
       AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ORDER BY ur.created_at DESC`,
    [workingGroupSlug, GROUP_LEAD_ROLE_ID, GROUP_DEPUTY_LEAD_ROLE_ID],
  );

  const toPublic = (row: (typeof rows)[number] | undefined): WorkingGroupChairPublic | null => {
    if (!row) return null;
    return toPublicRoleProfile(row);
  };

  return {
    chair: toPublic(rows.find((row) => row.role_id === GROUP_LEAD_ROLE_ID)),
    viceChair: toPublic(rows.find((row) => row.role_id === GROUP_DEPUTY_LEAD_ROLE_ID)),
  };
}

export async function getWorkingGroupByIdOrSlug(
  db: DatabaseLike,
  idOrSlug: string,
): Promise<WorkingGroupDetail | null> {
  const group = await getPublicWorkingGroup(db, idOrSlug);
  if (!group) return null;
  const [mailingList, { chair, viceChair }] = await Promise.all([
    first<{ email: string }>(
      db,
      `SELECT email FROM mailing_lists
       WHERE group_id = ? AND active = 1 AND is_primary_discussion = 1
       LIMIT 1`,
      [group.id],
    ),
    getWorkingGroupChairsPublic(db, group.slug),
  ]);
  return {
    id: group.id,
    name: group.name,
    slug: group.slug,
    description: group.description,
    active: group.active,
    mailingListEmail: mailingList?.email ?? null,
    chair,
    viceChair,
  };
}

export async function listWorkingGroupMembers(
  db: DatabaseLike,
  idOrSlug: string,
  params: PublicWorkingGroupMembersListQuery,
): Promise<{ members: WorkingGroupMemberPublic[]; total: number } | null> {
  const workingGroup = await getPublicWorkingGroup(db, idOrSlug);
  if (!workingGroup) return null;

  const search = params.q
    ? buildD1TextSearchFilter(params.q, ["u.first_name", "u.last_name", "u.first_name || ' ' || u.last_name", "o.name"])
    : null;
  const where = search ? ` AND ${search.sql}` : "";
  const bindings = [workingGroup.id, ...(search?.bindings ?? [])];
  const from = `FROM (
       SELECT user_id, MIN(joined_at) AS first_joined_at
       FROM group_memberships
       WHERE group_id = ? AND left_at IS NULL
       GROUP BY user_id
     ) participant
     JOIN users u ON u.id = participant.user_id
     LEFT JOIN members m ON m.id = (
       SELECT capacity.member_id
       FROM group_memberships capacity
       WHERE capacity.group_id = ?
         AND capacity.user_id = participant.user_id
         AND capacity.left_at IS NULL
       ORDER BY capacity.joined_at ASC, capacity.id ASC
       LIMIT 1
     )
     LEFT JOIN organizations o ON o.id = m.organization_id
     WHERE 1 = 1${where}`;
  const orderBy = resolveMappedOrderBy(
    params.sort,
    { name: "COALESCE(u.last_name, u.first_name)", organizationName: "o.name" },
    "COALESCE(u.last_name, u.first_name) COLLATE NOCASE ASC",
    "u.id ASC",
  );
  const result = await queryPage<WorkingGroupMemberRow>(db, {
    sql: `SELECT u.first_name, u.last_name, o.name AS org_name ${from}`,
    bindings: [workingGroup.id, workingGroup.id, ...bindings.slice(1)],
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });
  return {
    members: result.rows.map((row) => ({
      name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unknown",
      organizationName: row.org_name,
    })),
    total: result.total,
  };
}
