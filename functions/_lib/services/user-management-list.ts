import {
  USERS_SORT_COLUMNS,
  usersListResponseSchema,
  type UsersListQuery,
} from "../../../assets/shared/schemas/user-management";
import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import { queryPage } from "../db/pagination";
import { resolveOrderBy } from "../db/sort";
import type { DatabaseLike } from "../types";
import { buildUserIdentitySearchFilter } from "./user-search";
import { publicUserHeadshotPath } from "./user-headshot";

interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  active: number;
  created_at: string;
  headshot_r2_key: string | null;
  active_identity_count: number;
  event_participation_count: number;
}

const USER_HAS_MEMBERSHIP = `(EXISTS (
    SELECT 1
      FROM identities member_identity
     WHERE member_identity.user_id = u.id
       AND member_identity.started_at IS NOT NULL
       AND member_identity.ended_at IS NULL
       AND member_identity.blocked_at IS NULL
  ))`;

const USER_HAS_EVENT_PARTICIPATION = "EXISTS (SELECT 1 FROM event_participant_role_sources ep WHERE ep.user_id = u.id)";

export function buildUsersPageQuery(query: UsersListQuery) {
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
  const orderBy = resolveOrderBy(query.sort, USERS_SORT_COLUMNS, "ORDER BY u.role ASC, u.email ASC", "u.id ASC");

  return {
    source: {
      selectSql: `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.active, u.created_at,
              u.headshot_r2_key,
              (SELECT COUNT(*) FROM identities active_identity
                WHERE active_identity.user_id = u.id
                  AND active_identity.started_at IS NOT NULL
                  AND active_identity.ended_at IS NULL
                  AND active_identity.blocked_at IS NULL) AS active_identity_count,
              (SELECT COUNT(DISTINCT ep.event_id)
                 FROM event_participant_role_sources ep
                WHERE ep.user_id = u.id) AS event_participation_count`,
      fromSql: `FROM users u ${where}`,
      countFromSql: `FROM users u ${where}`,
      bindings,
    },
    orderBy,
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listUsers(db: DatabaseLike, query: UsersListQuery) {
  const { rows: users, total } = await queryPage<UserRow>(db, buildUsersPageQuery(query));

  const results = users.map(
    ({ headshot_r2_key: headshotR2Key, event_participation_count: participationCount, ...row }) => ({
      ...row,
      headshotUrl: publicUserHeadshotPath(headshotR2Key),
      activeIdentityCount: row.active_identity_count,
      type: row.active_identity_count > 0 ? "member" : participationCount > 0 ? "event_attendee" : "contact_only",
      eventParticipationCount: participationCount,
    }),
  );
  return usersListResponseSchema.parse({
    users: results,
    page: buildPageInfo(query.limit, query.offset, total, results.length),
  });
}
