import type {
  Group,
  GroupMembership,
  GroupMembershipsListQuery,
  GroupsListQuery,
} from "../../../../assets/shared/schemas/groups";
import { GROUP_MEMBERSHIP_SORT_COLUMNS, GROUP_SORT_COLUMNS } from "../../../../assets/shared/schemas/groups";
import { queryPage, type OffsetPageQuery } from "../../db/pagination";
import { all, first } from "../../db/queries";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import {
  ACTIVE_USER_CAPACITIES_CTE,
  activeParentGroupMembershipPredicate,
  eligibleGroupCapacityPredicate,
} from "../membership/capacity-query";

interface GroupRow {
  id: string;
  slug: string;
  name: string;
  type_key: string;
  type_singular_label: string;
  type_plural_label: string;
  parent_id: string | null;
  parent_slug: string | null;
  parent_name: string | null;
  parent_type_key: string | null;
  parent_type_singular_label: string | null;
  parent_type_plural_label: string | null;
  description: string | null;
  links_json: string | null;
  visibility: Group["visibility"];
  governance_inheritance_mode: "inherited" | "local_only";
  eligibility_mode: "open" | "category" | "managed";
  automatic_enrollment_mode: "none" | "category";
  allow_automatic_opt_out: number;
  public_leadership: number;
  min_endorsers_for_ballot: number;
  active: number;
  revision: number;
  membership_capacity_count: number;
  participant_count: number;
  child_count: number;
  created_at: string;
  updated_at: string;
}

const GROUP_SELECT = `SELECT
  g.id, g.slug, g.name, g.type_key,
  gt.singular_label AS type_singular_label,
  gt.plural_label AS type_plural_label,
  parent.id AS parent_id, parent.slug AS parent_slug, parent.name AS parent_name,
  parent.type_key AS parent_type_key,
  parent_type.singular_label AS parent_type_singular_label,
  parent_type.plural_label AS parent_type_plural_label,
  g.description, g.links_json, g.visibility, g.governance_inheritance_mode,
  g.eligibility_mode, g.automatic_enrollment_mode,
  g.allow_automatic_opt_out, g.public_leadership, g.min_endorsers_for_ballot, g.active, g.revision,
  (SELECT COUNT(*) FROM group_memberships capacity
    WHERE capacity.group_id = g.id AND capacity.left_at IS NULL) AS membership_capacity_count,
  (SELECT COUNT(DISTINCT participant.user_id) FROM group_memberships participant
    WHERE participant.group_id = g.id AND participant.left_at IS NULL) AS participant_count,
  (SELECT COUNT(*) FROM groups child
    WHERE child.parent_group_id = g.id AND child.active = 1) AS child_count,
  g.created_at, g.updated_at`;

const GROUP_FROM = `FROM groups g
  JOIN group_types gt ON gt.key = g.type_key
  LEFT JOIN groups parent ON parent.id = g.parent_group_id
  LEFT JOIN group_types parent_type ON parent_type.key = parent.type_key`;

function mapGroup(row: GroupRow): Group {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: {
      key: row.type_key,
      singularLabel: row.type_singular_label,
      pluralLabel: row.type_plural_label,
    },
    parentGroup:
      row.parent_id && row.parent_slug && row.parent_name && row.parent_type_key
        ? {
            id: row.parent_id,
            slug: row.parent_slug,
            name: row.parent_name,
            type: {
              key: row.parent_type_key,
              singularLabel: row.parent_type_singular_label ?? row.parent_type_key,
              pluralLabel: row.parent_type_plural_label ?? row.parent_type_key,
            },
          }
        : null,
    description: row.description,
    links: parseLinksJson(row.links_json),
    visibility: row.visibility,
    governanceInheritanceMode: row.governance_inheritance_mode,
    eligibilityMode: row.eligibility_mode,
    automaticEnrollmentMode: row.automatic_enrollment_mode,
    allowAutomaticOptOut: row.allow_automatic_opt_out === 1,
    publicLeadership: row.public_leadership === 1,
    minEndorsersForBallot: row.min_endorsers_for_ballot,
    active: row.active === 1,
    revision: row.revision,
    membershipCapacityCount: row.membership_capacity_count,
    participantCount: row.participant_count,
    childCount: row.child_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const GROUP_SORT_EXPRESSIONS = {
  name: "g.name COLLATE NOCASE",
  slug: "g.slug COLLATE NOCASE",
  type: "gt.sort_order",
  participant_count: "participant_count",
  created_at: "g.created_at",
} satisfies Record<(typeof GROUP_SORT_COLUMNS)[number], string>;

export interface GroupListAccess {
  userId?: string;
  canReadAll?: boolean;
  participationView?: "catalog" | "joined";
  /** Additional trusted SQL authorization applied before counting and paging. */
  requiredAuthorization?: AuthorizationEvidence;
}

interface GroupVisibilityFilter {
  sql: string;
  bindings: unknown[];
}

function buildGroupVisibilityFilter(access: GroupListAccess): GroupVisibilityFilter | null {
  if (access.canReadAll) return null;
  if (!access.userId) return { sql: "g.visibility = 'public'", bindings: [] };
  return {
    sql: `(
      g.visibility IN ('public', 'authenticated')
      OR EXISTS (
        SELECT 1 FROM group_memberships visible_membership
        WHERE visible_membership.group_id = g.id
          AND visible_membership.user_id = ?
          AND visible_membership.left_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM permission_grants visible_grant
        WHERE visible_grant.user_id = ?
          AND visible_grant.permission = 'groups:read'
          AND visible_grant.context_type = 'group'
          AND visible_grant.context_id = g.id
          AND visible_grant.revoked_at IS NULL
          AND (visible_grant.expires_at IS NULL OR visible_grant.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
      OR EXISTS (
        WITH RECURSIVE visible_lineage(id, continue_up) AS (
          SELECT g.id, CASE WHEN g.governance_inheritance_mode = 'inherited' THEN 1 ELSE 0 END
          UNION ALL
          SELECT parent.id, CASE WHEN parent.governance_inheritance_mode = 'inherited' THEN 1 ELSE 0 END
          FROM visible_lineage lineage
          JOIN groups child ON child.id = lineage.id
          JOIN groups parent ON parent.id = child.parent_group_id
          WHERE lineage.continue_up = 1
        )
        SELECT 1
        FROM visible_lineage lineage
        JOIN user_roles visible_role
          ON visible_role.context_type = 'group'
         AND visible_role.context_id = lineage.id
         AND visible_role.user_id = ?
         AND visible_role.role_id IN ('role-group_lead', 'role-group_deputy_lead')
         AND visible_role.revoked_at IS NULL
         AND (visible_role.expires_at IS NULL OR visible_role.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        JOIN role_permissions visible_permission
          ON visible_permission.role_id = visible_role.role_id
         AND visible_permission.permission = 'groups:read'
        LIMIT 1
      )
    )`,
    bindings: [access.userId, access.userId, access.userId],
  };
}

function buildGroupParticipationFilter(access: GroupListAccess): GroupVisibilityFilter | null {
  if (!access.participationView) return null;
  if (!access.userId) throw new Error("A participation view requires a userId");
  const joinedSql = `EXISTS (
    SELECT 1 FROM group_memberships own_membership
    WHERE own_membership.group_id = g.id
      AND own_membership.user_id = ?
      AND own_membership.left_at IS NULL
  )`;
  if (access.participationView === "joined") return { sql: joinedSql, bindings: [access.userId] };
  return {
    sql: `(
      ${joinedSql}
      OR (
        g.active = 1
        AND EXISTS (
          ${ACTIVE_USER_CAPACITIES_CTE}
          SELECT 1
          FROM active_user_capacities capacity
          LEFT JOIN group_membership_category_rules rule
            ON rule.group_id = g.id
           AND rule.membership_category_code = capacity.membership_category
          WHERE ${eligibleGroupCapacityPredicate("g", "rule")}
          LIMIT 1
        )
        AND ${activeParentGroupMembershipPredicate("g", "?")}
      )
    )`,
    bindings: [access.userId, access.userId, access.userId],
  };
}

export function buildGroupsPageQuery(
  query: GroupsListQuery,
  access: GroupListAccess = { canReadAll: true },
): OffsetPageQuery {
  const search = query.q ? buildD1TextSearchFilter(query.q, ["g.name", "g.slug", "g.description"]) : null;
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  // A management projection is already a stronger visibility boundary. Do
  // not also require participation/read visibility: an exact write grant must
  // be able to discover the group it authorizes.
  const visibility = access.requiredAuthorization ? null : buildGroupVisibilityFilter(access);
  if (visibility) {
    conditions.push(visibility.sql);
    bindings.push(...visibility.bindings);
  }
  const participation = buildGroupParticipationFilter(access);
  if (participation) {
    conditions.push(participation.sql);
    bindings.push(...participation.bindings);
  }
  if (access.requiredAuthorization) {
    conditions.push(`EXISTS (${access.requiredAuthorization.sql})`);
    bindings.push(...access.requiredAuthorization.bindings);
  }
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.active !== undefined) {
    conditions.push("g.active = ?");
    bindings.push(query.active ? 1 : 0);
  }
  if (query.typeKey !== undefined) {
    conditions.push("g.type_key = ?");
    bindings.push(query.typeKey);
  }
  if (query.parentGroupId !== undefined) {
    conditions.push(query.parentGroupId === null ? "g.parent_group_id IS NULL" : "g.parent_group_id = ?");
    if (query.parentGroupId !== null) bindings.push(query.parentGroupId);
  }
  if (query.eligibilityMode !== undefined) {
    conditions.push("g.eligibility_mode = ?");
    bindings.push(query.eligibilityMode);
  }
  if (query.automaticEnrollmentMode !== undefined) {
    conditions.push("g.automatic_enrollment_mode = ?");
    bindings.push(query.automaticEnrollmentMode);
  }
  if (query.visibility !== undefined) {
    conditions.push("g.visibility = ?");
    bindings.push(query.visibility);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return {
    source: {
      selectSql: GROUP_SELECT,
      fromSql: `${GROUP_FROM} ${where}`,
      countFromSql: `FROM groups g JOIN group_types gt ON gt.key = g.type_key ${where}`,
      bindings,
    },
    orderBy: resolveMappedOrderBy(query.sort, GROUP_SORT_EXPRESSIONS, GROUP_SORT_EXPRESSIONS.name, "g.id ASC"),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listGroups(
  db: DatabaseLike,
  query: GroupsListQuery,
  access: GroupListAccess = { canReadAll: true },
): Promise<{ groups: Group[]; total: number }> {
  const { rows, total } = await queryPage<GroupRow>(db, buildGroupsPageQuery(query, access));
  return { groups: rows.map(mapGroup), total };
}

export async function getGroup(db: DatabaseLike, idOrSlug: string): Promise<Group | null> {
  const row = await first<GroupRow>(db, `${GROUP_SELECT} ${GROUP_FROM} WHERE g.id = ? OR g.slug = ?`, [
    idOrSlug,
    idOrSlug,
  ]);
  return row ? mapGroup(row) : null;
}

export async function getVisibleGroup(
  db: DatabaseLike,
  idOrSlug: string,
  access: GroupListAccess,
): Promise<Group | null> {
  const visibility = buildGroupVisibilityFilter(access);
  const conditions = ["(g.id = ? OR g.slug = ?)", "g.active = 1"];
  const bindings: unknown[] = [idOrSlug, idOrSlug];
  if (visibility) {
    conditions.push(visibility.sql);
    bindings.push(...visibility.bindings);
  }
  const row = await first<GroupRow>(db, `${GROUP_SELECT} ${GROUP_FROM} WHERE ${conditions.join(" AND ")}`, bindings);
  return row ? mapGroup(row) : null;
}

interface MembershipRow {
  id: string;
  group_id: string;
  user_id: string;
  member_id: string;
  member_type: "individual" | "organization";
  first_name: string | null;
  last_name: string | null;
  email: string;
  organization_name: string | null;
  membership_category: string | null;
  source: GroupMembership["source"];
  created_by_user_id: string | null;
  joined_at: string;
  left_at: string | null;
}

function mapMembership(row: MembershipRow): GroupMembership {
  return {
    id: row.id,
    groupId: row.group_id,
    userId: row.user_id,
    memberId: row.member_id,
    memberType: row.member_type,
    userName: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
    email: row.email,
    organizationName: row.organization_name,
    membershipCategory: row.membership_category as GroupMembership["membershipCategory"],
    source: row.source,
    createdByUserId: row.created_by_user_id,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
  };
}

const MEMBERSHIP_FROM = `FROM group_memberships gm
  JOIN users u ON u.id = gm.user_id
  JOIN members m ON m.id = gm.member_id
  LEFT JOIN organizations o ON o.id = m.organization_id
  LEFT JOIN member_category_assignments mca ON mca.member_id = m.id`;

const MEMBERSHIP_SORT_EXPRESSIONS = {
  user_name: "LOWER(COALESCE(u.last_name, '') || ' ' || COALESCE(u.first_name, '') || ' ' || u.email)",
  email: "LOWER(u.email)",
  organization_name: "LOWER(COALESCE(o.name, ''))",
  membership_category: "mca.category_code",
  joined_at: "gm.joined_at",
} satisfies Record<(typeof GROUP_MEMBERSHIP_SORT_COLUMNS)[number], string>;

export function buildGroupMembershipsPageQuery(groupId: string, query: GroupMembershipsListQuery): OffsetPageQuery {
  const search = query.q
    ? buildD1TextSearchFilter(query.q, ["u.first_name", "u.last_name", "u.email", "o.name", "mca.category_code"])
    : null;
  const conditions = ["gm.group_id = ?"];
  const bindings: unknown[] = [groupId];
  if (query.active) conditions.push("gm.left_at IS NULL");
  else conditions.push("gm.left_at IS NOT NULL");
  if (query.userId) {
    conditions.push("gm.user_id = ?");
    bindings.push(query.userId);
  }
  if (query.memberId) {
    conditions.push("gm.member_id = ?");
    bindings.push(query.memberId);
  }
  if (query.membershipCategory) {
    conditions.push("mca.category_code = ?");
    bindings.push(query.membershipCategory);
  }
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const fromSql = `${MEMBERSHIP_FROM} WHERE ${conditions.join(" AND ")}`;
  return {
    source: {
      selectSql: `SELECT gm.id, gm.group_id, gm.user_id, gm.member_id, m.member_type,
        u.first_name, u.last_name, u.email, o.name AS organization_name,
        mca.category_code AS membership_category, gm.source, gm.created_by_user_id,
        gm.joined_at, gm.left_at`,
      fromSql,
      bindings,
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      MEMBERSHIP_SORT_EXPRESSIONS,
      MEMBERSHIP_SORT_EXPRESSIONS.user_name,
      "gm.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listGroupMemberships(
  db: DatabaseLike,
  groupId: string,
  query: GroupMembershipsListQuery,
): Promise<{ memberships: GroupMembership[]; total: number }> {
  const { rows, total } = await queryPage<MembershipRow>(db, buildGroupMembershipsPageQuery(groupId, query));
  return { memberships: rows.map(mapMembership), total };
}

export async function listActiveGroupMembershipsForUser(
  db: DatabaseLike,
  groupId: string,
  userId: string,
): Promise<GroupMembership[]> {
  const rows = await all<MembershipRow>(
    db,
    `SELECT gm.id, gm.group_id, gm.user_id, gm.member_id, m.member_type,
            u.first_name, u.last_name, u.email, o.name AS organization_name,
            mca.category_code AS membership_category, gm.source,
            gm.created_by_user_id, gm.joined_at, gm.left_at
       ${MEMBERSHIP_FROM}
      WHERE gm.group_id = ? AND gm.user_id = ? AND gm.left_at IS NULL
      ORDER BY LOWER(COALESCE(o.name, '')), gm.member_id, gm.id`,
    [groupId, userId],
  );
  return rows.map(mapMembership);
}

export async function listActiveGroupMembershipsForGroupsForUser(
  db: DatabaseLike,
  groupIds: readonly string[],
  userId: string,
): Promise<Map<string, GroupMembership[]>> {
  const byGroup = new Map<string, GroupMembership[]>();
  if (groupIds.length === 0) return byGroup;
  const rows = await all<MembershipRow>(
    db,
    `SELECT gm.id, gm.group_id, gm.user_id, gm.member_id, m.member_type,
            u.first_name, u.last_name, u.email, o.name AS organization_name,
            mca.category_code AS membership_category, gm.source,
            gm.created_by_user_id, gm.joined_at, gm.left_at
       ${MEMBERSHIP_FROM}
       JOIN json_each(?) requested_group ON requested_group.value = gm.group_id
      WHERE gm.user_id = ? AND gm.left_at IS NULL
      ORDER BY gm.group_id, LOWER(COALESCE(o.name, '')), gm.member_id, gm.id`,
    [JSON.stringify(groupIds), userId],
  );
  for (const row of rows) {
    const memberships = byGroup.get(row.group_id) ?? [];
    memberships.push(mapMembership(row));
    byGroup.set(row.group_id, memberships);
  }
  return byGroup;
}
