import type {
  AdminWorkingGroupMember,
  AdminWorkingGroupSummary,
  WorkingGroupMembersListQuery,
  WorkingGroupsListQuery,
} from "../../../../assets/shared/schemas/working-groups";
import {
  ADMIN_WORKING_GROUP_MEMBER_SORT_COLUMNS,
  ADMIN_WORKING_GROUP_SORT_COLUMNS,
} from "../../../../assets/shared/schemas/working-groups";
import { AppError } from "../../errors";
import { first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy, resolveOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { deterministicRepresentativeJoinSql } from "../membership/representative-lookup";
import { currentGroupRoleHolderSql, GROUP_DEPUTY_LEAD_ROLE_ID, GROUP_LEAD_ROLE_ID } from "../group-leadership-query";
import { getWorkingGroupBySlugOrId } from "../working-groups";

interface WorkingGroupSummaryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  mailing_list_email: string | null;
  min_endorsers_for_ballot: number;
  active: number;
  created_at: string;
  updated_at: string;
  member_count: number;
  chair_user_role_id: string | null;
  chair_user_id_resolved: string | null;
  chair_first_name: string | null;
  chair_last_name: string | null;
  chair_email: string | null;
  chair_expires_at: string | null;
  vice_chair_user_role_id: string | null;
  vice_chair_user_id: string | null;
  vice_chair_first_name: string | null;
  vice_chair_last_name: string | null;
  vice_chair_email: string | null;
  vice_chair_expires_at: string | null;
}

function toRoleHolder(
  userRoleId: string | null,
  userId: string | null,
  firstName: string | null,
  lastName: string | null,
  email: string | null,
  expiresAt: string | null,
): AdminWorkingGroupSummary["chair"] {
  if (!userRoleId || !userId) return null;
  return {
    userRoleId,
    userId,
    name: [firstName, lastName].filter(Boolean).join(" ") || email || "Unknown",
    email: email ?? "",
    expiresAt,
  };
}

function toSummary(row: WorkingGroupSummaryRow): AdminWorkingGroupSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    mailingListEmail: row.mailing_list_email,
    minEndorsersForBallot: row.min_endorsers_for_ballot,
    active: row.active === 1,
    chair: toRoleHolder(
      row.chair_user_role_id,
      row.chair_user_id_resolved,
      row.chair_first_name,
      row.chair_last_name,
      row.chair_email,
      row.chair_expires_at,
    ),
    viceChair: toRoleHolder(
      row.vice_chair_user_role_id,
      row.vice_chair_user_id,
      row.vice_chair_first_name,
      row.vice_chair_last_name,
      row.vice_chair_email,
      row.vice_chair_expires_at,
    ),
    memberCount: row.member_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SUMMARY_SELECT = `
  SELECT wg.id, wg.name, wg.slug, wg.description, wg.mailing_list_email, wg.min_endorsers_for_ballot,
         wg.active, wg.created_at, wg.updated_at,
         (SELECT COUNT(*) FROM working_group_members wgm
           WHERE wgm.working_group_id = wg.id AND wgm.left_at IS NULL) AS member_count,
         chair.user_role_id AS chair_user_role_id, chair.user_id AS chair_user_id_resolved,
         chair.first_name AS chair_first_name, chair.last_name AS chair_last_name, chair.email AS chair_email,
         chair.expires_at AS chair_expires_at,
         vice_chair.user_role_id AS vice_chair_user_role_id, vice_chair.user_id AS vice_chair_user_id,
         vice_chair.first_name AS vice_chair_first_name, vice_chair.last_name AS vice_chair_last_name,
         vice_chair.email AS vice_chair_email, vice_chair.expires_at AS vice_chair_expires_at`;

const SUMMARY_FROM = `FROM working_groups wg
  LEFT JOIN (${currentGroupRoleHolderSql(GROUP_LEAD_ROLE_ID)}) chair ON chair.group_id = wg.id
  LEFT JOIN (${currentGroupRoleHolderSql(GROUP_DEPUTY_LEAD_ROLE_ID)}) vice_chair ON vice_chair.group_id = wg.id`;

export function buildAdminWorkingGroupsPageQuery(query: WorkingGroupsListQuery) {
  const search = query.q
    ? buildD1TextSearchFilter(query.q, ["wg.name", "wg.slug", "wg.description", "wg.mailing_list_email"])
    : null;
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.active) {
    conditions.push("wg.active = ?");
    bindings.push(query.active === "true" ? 1 : 0);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = resolveOrderBy(query.sort, ADMIN_WORKING_GROUP_SORT_COLUMNS, "ORDER BY wg.name ASC", "wg.id ASC");

  return {
    source: {
      selectSql: SUMMARY_SELECT,
      fromSql: `${SUMMARY_FROM} ${where}`,
      countFromSql: `FROM working_groups wg ${where}`,
      bindings,
    },
    orderBy,
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listAdminWorkingGroups(
  db: DatabaseLike,
  query: WorkingGroupsListQuery,
): Promise<{ workingGroups: AdminWorkingGroupSummary[]; total: number }> {
  const { rows, total } = await queryPage<WorkingGroupSummaryRow>(db, buildAdminWorkingGroupsPageQuery(query));
  return { workingGroups: rows.map(toSummary), total };
}

export async function getAdminWorkingGroupDetail(
  db: DatabaseLike,
  idOrSlug: string,
): Promise<AdminWorkingGroupSummary | null> {
  const row = await first<WorkingGroupSummaryRow>(
    db,
    `${SUMMARY_SELECT} ${SUMMARY_FROM} WHERE wg.id = ? OR wg.slug = ?`,
    [idOrSlug, idOrSlug],
  );
  return row ? toSummary(row) : null;
}

const WORKING_GROUP_MEMBER_FROM_SQL = `FROM working_group_members wgm
  JOIN users u ON u.id = wgm.user_id
${deterministicRepresentativeJoinSql("wgm.user_id")}
  LEFT JOIN members m ON m.id = COALESCE(
    wgm.member_id,
    rep.member_id,
    (
      SELECT fallback.id FROM members fallback
      WHERE fallback.user_id = wgm.user_id AND fallback.status = 'active'
      ORDER BY datetime(fallback.created_at) ASC, fallback.id ASC
      LIMIT 1
    )
  )
  LEFT JOIN organizations o ON o.id = m.organization_id
  LEFT JOIN member_category_assignments mca ON mca.member_id = m.id`;

const WORKING_GROUP_MEMBER_SORT_EXPRESSIONS = {
  name: "LOWER(COALESCE(u.last_name, '') || ' ' || COALESCE(u.first_name, '') || ' ' || u.email)",
  email: "LOWER(u.email)",
  organization_name: "LOWER(o.name)",
  member_category: "mca.category_code",
  joined_at: "wgm.joined_at",
} satisfies Record<(typeof ADMIN_WORKING_GROUP_MEMBER_SORT_COLUMNS)[number], string>;

export async function listAdminWorkingGroupMembers(
  db: DatabaseLike,
  idOrSlug: string,
  query: WorkingGroupMembersListQuery,
): Promise<{ members: AdminWorkingGroupMember[]; total: number }> {
  const workingGroup = await getWorkingGroupBySlugOrId(db, idOrSlug);
  if (!workingGroup) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  const search = query.q
    ? buildD1TextSearchFilter(query.q, ["u.first_name", "u.last_name", "u.email", "o.name", "mca.category_code"])
    : null;
  const where = `WHERE wgm.working_group_id = ? AND wgm.left_at IS NULL${search ? ` AND ${search.sql}` : ""}`;
  const bindings = [workingGroup.id, ...(search?.bindings ?? [])];
  const orderBy = resolveMappedOrderBy(
    query.sort,
    WORKING_GROUP_MEMBER_SORT_EXPRESSIONS,
    WORKING_GROUP_MEMBER_SORT_EXPRESSIONS.name,
    "u.id ASC",
  );
  const { rows, total } = await queryPage<{
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    org_name: string | null;
    category_code: string | null;
    joined_at: string;
  }>(db, {
    sql: `SELECT u.id AS user_id, u.first_name, u.last_name, u.email,
                   o.name AS org_name, mca.category_code, wgm.joined_at
            ${WORKING_GROUP_MEMBER_FROM_SQL}
            ${where}`,
    bindings,
    orderBy,
    limit: query.limit,
    offset: query.offset,
  });

  return {
    members: rows.map((member) => ({
      userId: member.user_id,
      name: [member.first_name, member.last_name].filter(Boolean).join(" ") || "Unknown",
      email: member.email,
      organizationName: member.org_name,
      memberCategory: member.category_code,
      joinedAt: member.joined_at,
    })),
    total,
  };
}
