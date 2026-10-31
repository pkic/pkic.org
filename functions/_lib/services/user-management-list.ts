import { affiliationJobTitleSql, affiliationOrganizationNameSql } from "./identities/affiliation-projection";
import {
  USER_LIST_ORGANIZATION_NAMES,
  USERS_SORT_COLUMNS,
  usersListResponseSchema,
  type UsersListQuery,
} from "../../../assets/shared/schemas/user-management";
import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import { buildOffsetPageStatements, decodeOffsetPageResults } from "../db/pagination";
import { resolveOrderBy } from "../db/sort";
import type { DatabaseLike } from "../types";
import { buildUserIdentitySearchFilter } from "./user-search";
import { publicUserHeadshotPath } from "./user-headshot";

interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  active: number;
  created_at: string;
  headshot_r2_key: string | null;
  organization_name: string | null;
  job_title: string | null;
  active_identity_count: number;
  organization_names: string | null;
  has_membership: number;
  has_event_participation: number;
}

/** Separates organization names inside the aggregated column; never appears in a name. */
const NAME_SEPARATOR = "\u001f";

const USER_HAS_MEMBERSHIP = `(EXISTS (
    SELECT 1
      FROM identities member_identity
      JOIN identity_member_capacities capacity ON capacity.identity_id = member_identity.id
     WHERE member_identity.user_id = u.id
       AND capacity.member_status = 'active'
       AND member_identity.started_at IS NOT NULL
       AND member_identity.ended_at IS NULL
       AND member_identity.blocked_at IS NULL
  ))`;

const USER_HAS_EVENT_PARTICIPATION = "EXISTS (SELECT 1 FROM event_participant_role_sources ep WHERE ep.user_id = u.id)";

export function buildUsersPageQuery(query: UsersListQuery) {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
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
  const orderBy = resolveOrderBy(query.sort, USERS_SORT_COLUMNS, "ORDER BY u.email ASC", "u.id ASC");

  return {
    source: {
      // Bounded projections keep affiliation names separate from membership.
      // Names replace
      // the old "1 active identity · 1 event" counts — a name tells the
      // reader which Ada this is; a count of events did not, and cost a
      // DISTINCT over the participation table for every row.
      selectSql: `SELECT u.id, u.email, u.first_name, u.last_name, u.active, u.created_at,
              u.headshot_r2_key,
              ${affiliationOrganizationNameSql("u.id")} AS organization_name,
              ${affiliationJobTitleSql("u.id")} AS job_title,
              (SELECT COUNT(*) FROM identities active_identity
                WHERE active_identity.user_id = u.id
                  AND active_identity.started_at IS NOT NULL
                  AND active_identity.ended_at IS NULL
                  AND active_identity.blocked_at IS NULL) AS active_identity_count,
              (SELECT group_concat(named.name, '${NAME_SEPARATOR}')
                 FROM (SELECT o.name
                         FROM identities named_identity
                         JOIN organizations o ON o.id = named_identity.organization_id
                        WHERE named_identity.user_id = u.id
                          AND named_identity.started_at IS NOT NULL
                          AND named_identity.ended_at IS NULL
                          AND named_identity.blocked_at IS NULL
                        ORDER BY o.name
                        LIMIT ${String(USER_LIST_ORGANIZATION_NAMES)}) named) AS organization_names,
              ${USER_HAS_MEMBERSHIP} AS has_membership,
              ${USER_HAS_EVENT_PARTICIPATION} AS has_event_participation`,
      fromSql: `FROM users u ${where}`,
      countFromSql: `FROM users u ${where}`,
      bindings,
    },
    orderBy,
    limit: query.limit,
    offset: query.offset,
  };
}

export function prepareUsersList(db: DatabaseLike, query: UsersListQuery) {
  return {
    statements: buildOffsetPageStatements(db, buildUsersPageQuery(query)),
    decode(loaded: import("../types").D1StatementResult[]) {
      const { rows: users, total } = decodeOffsetPageResults<UserRow>(loaded[0]!, loaded[1]!);

      const results = users.map(
        ({
          headshot_r2_key: headshotR2Key,
          active_identity_count: organizationCount,
          organization_names: organizationNames,
          has_membership: hasMembership,
          has_event_participation: hasEventParticipation,
          ...row
        }) => ({
          ...row,
          headshotUrl: publicUserHeadshotPath(row.id, headshotR2Key),
          type: hasMembership ? "member" : hasEventParticipation ? "event_attendee" : "contact_only",
          organizationNames: organizationNames ? organizationNames.split(NAME_SEPARATOR) : [],
          organizationCount,
        }),
      );
      return usersListResponseSchema.parse({
        users: results,
        page: buildPageInfo(query.limit, query.offset, total, results.length),
      });
    },
  };
}
export async function listUsers(db: DatabaseLike, query: UsersListQuery) {
  const read = prepareUsersList(db, query);
  return read.decode(await db.batch(read.statements));
}
