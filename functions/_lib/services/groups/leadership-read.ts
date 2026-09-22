/** Bounded current and historical leadership pages with shared query semantics. */
import type {
  GroupLeadershipAssignment,
  GroupLeadershipListResponse,
  GroupLeadershipListQuery,
  GroupLeadershipRoleId,
  GroupLeadershipTitles,
  GroupLeadershipTitleOptions,
} from "../../../../assets/shared/schemas/groups";
import { defaultGroupLeadershipTitle, groupLeadershipListQuerySchema } from "../../../../assets/shared/schemas/groups";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { all, first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { publicUserHeadshotPath } from "../user-headshot";
import { EFFECTIVE_GROUP_LINEAGE_CTE } from "./governance";
import { getGroup } from "./read-model";

export const LEADERSHIP_ROLE_PREDICATE_SQL = `ur.role_id IN ('role-group_lead', 'role-group_deputy_lead')`;
const ACTIVE_LEADERSHIP_PREDICATE_SQL = `ur.revoked_at IS NULL
  AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

/**
 * The displayed title and term of one assignment. A row written before titles
 * existed falls back to its source group type's title for the role; the term
 * start falls back to the grant instant.
 */
export const LEADERSHIP_TERM_SELECT_SQL = `
  COALESCE(ur.title, CASE ur.role_id WHEN 'role-group_lead' THEN gt.lead_title ELSE gt.deputy_lead_title END) AS title,
  COALESCE(ur.starts_at, ur.created_at) AS starts_at,
  CASE WHEN ur.revoked_at IS NOT NULL THEN ur.revoked_at ELSE ur.expires_at END AS ends_at,
  CASE WHEN ${ACTIVE_LEADERSHIP_PREDICATE_SQL} THEN 1 ELSE 0 END AS active`;

interface LeadershipRow {
  user_role_id: string;
  user_id: string;
  identity_id: string;
  member_id: string;
  member_type: "individual" | "organization";
  organization_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  job_title: string | null;
  headshot_r2_key: string | null;
  role_id: GroupLeadershipRoleId;
  title: string;
  source_group_id: string;
  source_group_slug: string;
  source_group_name: string;
  source_group_type_key: string;
  source_group_type_singular_label: string;
  source_group_type_plural_label: string;
  depth: number;
  active: number;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
}

function mapLeadership(row: LeadershipRow): GroupLeadershipAssignment {
  return {
    userRoleId: row.user_role_id,
    userId: row.user_id,
    identityId: row.identity_id,
    memberId: row.member_id,
    memberType: row.member_type,
    organizationName: row.organization_name,
    userName: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
    email: row.email,
    jobTitle: row.job_title,
    headshotUrl: publicUserHeadshotPath(row.user_id, row.headshot_r2_key),
    roleId: row.role_id,
    title: row.title,
    sourceGroup: {
      id: row.source_group_id,
      slug: row.source_group_slug,
      name: row.source_group_name,
      type: {
        key: row.source_group_type_key,
        singularLabel: row.source_group_type_singular_label,
        pluralLabel: row.source_group_type_plural_label,
      },
    },
    inherited: row.depth > 0,
    active: row.active === 1,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
  };
}

const LEADERSHIP_ROW_SELECT_SQL = `
  SELECT ur.id AS user_role_id, ur.user_id, ur.identity_id, ur.member_id,
         CASE WHEN member.organization_id IS NULL THEN 'individual' ELSE 'organization' END AS member_type,
         organization.name AS organization_name,
         u.first_name, u.last_name,
         COALESCE(selected_email.email, u.email) AS email,
         identity.job_title, u.headshot_r2_key,
         ur.role_id, ${LEADERSHIP_TERM_SELECT_SQL},
         source_group.id AS source_group_id,
         source_group.slug AS source_group_slug, source_group.name AS source_group_name,
         source_group.type_key AS source_group_type_key,
         gt.singular_label AS source_group_type_singular_label,
         gt.plural_label AS source_group_type_plural_label,
         lineage.depth, ur.created_at`;

const LEADERSHIP_ORDER_SQL = `LOWER(COALESCE(u.last_name, '')), LOWER(COALESCE(u.first_name, '')), u.id`;

const LEADERSHIP_SORT = {
  person: "LOWER(COALESCE(u.last_name, '') || ' ' || COALESCE(u.first_name, ''))",
  title: "title",
  organization: "organization.name",
  starts_at: "starts_at",
  ends_at: "ends_at",
  source: "source_group.name",
};

async function leadershipPage(
  db: DatabaseLike,
  query: GroupLeadershipListQuery,
  sql: string,
  groupId: string,
  past: boolean,
) {
  const bindings: unknown[] = [groupId];
  if (query.userRoleId) {
    sql += " AND ur.id = ?";
    bindings.push(query.userRoleId);
  }
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, [
      "COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')",
      "COALESCE(selected_email.email, u.email)",
      "COALESCE(ur.title, CASE ur.role_id WHEN 'role-group_lead' THEN gt.lead_title ELSE gt.deputy_lead_title END)",
      "organization.name",
      "source_group.name",
    ]);
    sql += ` AND ${search.sql}`;
    bindings.push(...search.bindings);
  }
  const result = await queryPage<LeadershipRow>(db, {
    sql,
    bindings,
    limit: query.limit,
    offset: query.offset,
    orderBy: resolveMappedOrderBy(
      query.sort,
      LEADERSHIP_SORT,
      past
        ? `ends_at DESC, starts_at DESC, ${LEADERSHIP_ORDER_SQL}`
        : `lineage.depth, CASE ur.role_id WHEN 'role-group_lead' THEN 0 ELSE 1 END, ${LEADERSHIP_ORDER_SQL}`,
      "ur.id ASC",
    ),
  });
  return {
    rows: result.rows.map(mapLeadership),
    page: buildPageInfo(query.limit, query.offset, result.total, result.rows.length),
  };
}

/** Effective leadership now: local assignments and those inherited through ancestors. */
async function listCurrentLeadership(db: DatabaseLike, groupId: string, query: GroupLeadershipListQuery) {
  return leadershipPage(
    db,
    query,
    `${EFFECTIVE_GROUP_LINEAGE_CTE}
     ${LEADERSHIP_ROW_SELECT_SQL}
       FROM effective_lineage lineage
       JOIN groups source_group ON source_group.id = lineage.id
       JOIN group_types gt ON gt.key = source_group.type_key
       JOIN user_roles ur
         ON ur.context_type = 'group' AND ur.context_id = lineage.id
        AND ${LEADERSHIP_ROLE_PREDICATE_SQL}
        AND ${ACTIVE_LEADERSHIP_PREDICATE_SQL}
       JOIN users u ON u.id = ur.user_id AND u.active = 1
       JOIN group_memberships membership
         ON membership.group_id = source_group.id
        AND membership.user_id = ur.user_id
        AND membership.identity_id = ur.identity_id
        AND membership.member_id = ur.member_id
        AND membership.left_at IS NULL
       JOIN members member ON member.id = membership.member_id AND member.status = 'active'
       LEFT JOIN organizations organization ON organization.id = member.organization_id
       JOIN identities identity
         ON identity.id = ur.identity_id
        AND identity.user_id = ur.user_id
        AND identity.started_at IS NOT NULL
        AND identity.ended_at IS NULL
        AND identity.blocked_at IS NULL
       JOIN identity_member_capacities capacity
         ON capacity.identity_id = identity.id
        AND capacity.member_id = member.id
       LEFT JOIN user_emails selected_email ON selected_email.id = identity.email_id
      WHERE 1 = 1`,
    groupId,
    false,
  );
}

/**
 * Closed local terms, most recently ended first. History joins the exact
 * identity and Member the assignment was held through rather than a live
 * membership, so a former chair whose representation has since ended keeps
 * their attribution.
 */
async function listPastLeadership(db: DatabaseLike, groupId: string, query: GroupLeadershipListQuery) {
  return leadershipPage(
    db,
    query,
    `${LEADERSHIP_ROW_SELECT_SQL}
       FROM groups source_group
       JOIN group_types gt ON gt.key = source_group.type_key
       JOIN (SELECT 0 AS depth) lineage
       JOIN user_roles ur
         ON ur.context_type = 'group' AND ur.context_id = source_group.id
        AND ${LEADERSHIP_ROLE_PREDICATE_SQL}
        AND NOT (${ACTIVE_LEADERSHIP_PREDICATE_SQL})
       JOIN users u ON u.id = ur.user_id
       JOIN members member ON member.id = ur.member_id
       LEFT JOIN organizations organization ON organization.id = member.organization_id
       JOIN identities identity ON identity.id = ur.identity_id
       LEFT JOIN user_emails selected_email ON selected_email.id = identity.email_id
      WHERE source_group.id = ?
      `,
    groupId,
    true,
  );
}

/**
 * The title vocabulary offered for each role: the group type's own configured
 * title first, then the active reference rows in their curated order, with no
 * repeats.
 *
 * The type's title leads whether or not it is also a reference row, because
 * it is what this particular group calls the role; the reference table is the
 * shared vocabulary a manager reaches past it for (issue #29). Neither list
 * is compiled into the frontend.
 */
async function leadershipTitleOptions(
  db: DatabaseLike,
  titles: GroupLeadershipTitles,
): Promise<GroupLeadershipTitleOptions> {
  const rows = await all<{ role_id: GroupLeadershipRoleId; title: string }>(
    db,
    `SELECT role_id, title FROM group_leadership_titles
      WHERE active = 1 AND role_id IN ('role-group_lead', 'role-group_deputy_lead')
      ORDER BY role_id, sort_order, title`,
  );
  const forRole = (roleId: GroupLeadershipRoleId): string[] => [
    ...new Set([
      defaultGroupLeadershipTitle(titles, roleId),
      ...rows.filter((row) => row.role_id === roleId).map((row) => row.title),
    ]),
  ];
  return { lead: forRole("role-group_lead"), deputyLead: forRole("role-group_deputy_lead") };
}

export async function listEffectiveGroupLeadership(
  db: DatabaseLike,
  groupIdOrSlug: string,
  query: GroupLeadershipListQuery = groupLeadershipListQuerySchema.parse({}),
): Promise<GroupLeadershipListResponse> {
  const group = await getGroup(db, groupIdOrSlug);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  const typeTitles = await first<{ lead_title: string; deputy_lead_title: string }>(
    db,
    "SELECT lead_title, deputy_lead_title FROM group_types WHERE key = ?",
    [group.type.key],
  );
  if (!typeTitles) throw new AppError(500, "GROUP_TYPE_MISSING", "The group's type is not configured");
  const titles = { lead: typeTitles.lead_title, deputyLead: typeTitles.deputy_lead_title };
  const [titleOptions, assignments, past] = await Promise.all([
    leadershipTitleOptions(db, titles),
    listCurrentLeadership(db, group.id, query),
    listPastLeadership(db, group.id, query),
  ]);
  return {
    group: { id: group.id, slug: group.slug, name: group.name, type: group.type },
    governanceInheritanceMode: group.governanceInheritanceMode,
    titles,
    titleOptions,
    assignments: assignments.rows,
    page: assignments.page,
    past: past.rows,
    pastPage: past.page,
  };
}
