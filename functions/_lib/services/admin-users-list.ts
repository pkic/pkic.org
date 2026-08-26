import {
  ADMIN_USERS_SORT_COLUMNS,
  usersListResponseSchema,
  type AdminUsersListQuery,
} from "../../../assets/shared/schemas/admin-users";
import { parseLinksJson } from "../../../assets/shared/schemas/links";
import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import { queryPage } from "../db/pagination";
import { resolveOrderBy } from "../db/sort";
import type { DatabaseLike } from "../types";
import { deterministicRepresentativeJoinSql } from "./membership/representative-lookup";
import { buildUserIdentitySearchFilter } from "./user-search";

interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  role: string;
  active: number;
  created_at: string;
  links_json: string | null;
  member_id: string | null;
  member_category: string | null;
  member_status: string | null;
  member_organization_id: string | null;
  member_organization_name: string | null;
  event_participation_count: number;
}

const USER_HAS_MEMBERSHIP = `(EXISTS (
    SELECT 1 FROM members direct_member WHERE direct_member.user_id = u.id
  ) OR EXISTS (
    SELECT 1
      FROM organization_representatives member_rep
     WHERE member_rep.user_id = u.id AND member_rep.left_at IS NULL
  ))`;

const USER_HAS_EVENT_PARTICIPATION = "EXISTS (SELECT 1 FROM event_participant_role_sources ep WHERE ep.user_id = u.id)";

export function buildAdminUsersPageQuery(query: AdminUsersListQuery) {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (query.role) {
    conditions.push("u.role = ?");
    bindings.push(query.role);
  }
  if (query.type === "member") {
    conditions.push(USER_HAS_MEMBERSHIP);
  } else if (query.type === "event_attendee") {
    conditions.push(`NOT ${USER_HAS_MEMBERSHIP} AND ${USER_HAS_EVENT_PARTICIPATION}`);
  } else if (query.type === "contact_only") {
    conditions.push(`NOT ${USER_HAS_MEMBERSHIP} AND NOT ${USER_HAS_EVENT_PARTICIPATION}`);
  }
  if (query.q) {
    const search = buildUserIdentitySearchFilter(query.q);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const representativeJoin = deterministicRepresentativeJoinSql("u.id");
  const orderBy = resolveOrderBy(query.sort, ADMIN_USERS_SORT_COLUMNS, "ORDER BY u.role ASC, u.email ASC", "u.id ASC");

  return {
    source: {
      selectSql: `SELECT u.id, u.email, u.first_name, u.last_name, u.organization_name, u.role, u.active, u.created_at,
              u.links_json,
              COALESCE(rep.id, mi.id) AS member_id, mca.category_code AS member_category,
              COALESCE(m.status, mi.status) AS member_status,
              m.organization_id AS member_organization_id, o.name AS member_organization_name,
              (SELECT COUNT(DISTINCT ep.event_id)
                 FROM event_participant_role_sources ep
                WHERE ep.user_id = u.id) AS event_participation_count`,
      fromSql: `FROM users u
       ${representativeJoin}
       LEFT JOIN members m ON m.id = rep.member_id
       LEFT JOIN members mi ON mi.user_id = u.id
       LEFT JOIN organizations o ON o.id = m.organization_id
       LEFT JOIN member_category_assignments mca ON mca.member_id = COALESCE(m.id, mi.id)
       ${where}`,
      countFromSql: `FROM users u ${where}`,
      bindings,
    },
    orderBy,
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listAdminUsers(db: DatabaseLike, query: AdminUsersListQuery) {
  const { rows: users, total } = await queryPage<UserRow>(db, buildAdminUsersPageQuery(query));

  const results = users.map(({ links_json: linksJson, event_participation_count: participationCount, ...row }) => ({
    ...row,
    links: parseLinksJson(linksJson),
    membership: row.member_id
      ? {
          memberId: row.member_id,
          membershipCategory: row.member_category,
          status: row.member_status,
          organizationId: row.member_organization_id,
          organizationName: row.member_organization_name,
        }
      : null,
    type: row.member_id ? "member" : participationCount > 0 ? "event_attendee" : "contact_only",
    eventParticipationCount: participationCount,
  }));
  return usersListResponseSchema.parse({
    users: results,
    page: buildPageInfo(query.limit, query.offset, total, results.length),
  });
}
