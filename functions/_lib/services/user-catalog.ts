import {
  USER_CATALOG_SORT_COLUMNS,
  userCatalogListResponseSchema,
  type UserCatalogListQuery,
} from "../../../assets/shared/schemas/user-catalog";
import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import { isAuthorizationGuardFailure } from "../db/authorization-guard";
import { buildOffsetPageStatements, decodeOffsetPageResults, type OffsetPageQuery } from "../db/pagination";
import { resolveOrderBy } from "../db/sort";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike } from "../types";
import { groupCanSeatUserPredicate } from "./groups/capacities";
import { prepareGroupManagementAuthorizationGuard, requireGroupManagement } from "./groups/governance";
import { ALL_ACTIVE_USER_CAPACITIES_CTE } from "./membership/capacity-query";
import { getGroup } from "./groups/read-model";
import { buildUserIdentitySearchFilter } from "./user-search";

interface UserCatalogRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
}

/**
 * @param seatableInGroupId When given, only the users this group could
 *   actually seat. The picker and the seating command then answer one
 *   question instead of two: the roster picker used to offer every active
 *   user in the system and the seat was refused afterwards with
 *   `GROUP_CAPACITY_REQUIRED`, once a manager had already chosen a title and
 *   two dates (#25).
 */
export function buildUserCatalogPageQuery(query: UserCatalogListQuery, seatableInGroupId?: string): OffsetPageQuery {
  const conditions = ["u.active = 1"];
  const bindings: unknown[] = [];
  if (query.q) {
    const search = buildUserIdentitySearchFilter(query.q);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (seatableInGroupId) {
    conditions.push(groupCanSeatUserPredicate("u"));
    // The group, then the allow-managed flag the predicate documents: a
    // manager seating somebody may cross a `managed` group's own join gate,
    // which is what "managed" means.
    bindings.push(seatableInGroupId, 1);
  }
  return {
    source: {
      // The shared CTE prefix, so the count statement carries it too — a page
      // whose filter the count cannot see reports a total nothing matches.
      withSql: seatableInGroupId ? ALL_ACTIVE_USER_CAPACITIES_CTE : undefined,
      selectSql: "SELECT u.id, u.email, u.first_name, u.last_name, u.organization_name",
      fromSql: `FROM users u WHERE ${conditions.join(" AND ")}`,
      bindings,
    },
    orderBy: resolveOrderBy(query.sort, USER_CATALOG_SORT_COLUMNS, "ORDER BY u.email ASC", "u.id ASC"),
    limit: query.limit,
    offset: query.offset,
  };
}

export function serializeUserCatalogPage(query: UserCatalogListQuery, rows: UserCatalogRow[], total: number) {
  return userCatalogListResponseSchema.parse({
    users: rows,
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}

/** Data-minimized active-user read model for permission-assignment selectors. */
export async function listUserCatalog(db: DatabaseLike, query: UserCatalogListQuery) {
  const [pageResult, countResult] = await db.batch(buildOffsetPageStatements(db, buildUserCatalogPageQuery(query)));
  const { rows, total } = decodeOffsetPageResults<UserCatalogRow>(pageResult, countResult);
  return serializeUserCatalogPage(query, rows, total);
}

export async function listGroupUsers(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  query: UserCatalogListQuery,
) {
  const group = await getGroup(db, groupIdOrSlug);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  await requireGroupManagement(db, actor, group.id);

  const pageQuery = buildUserCatalogPageQuery(query, group.id);
  const pageStatements = buildOffsetPageStatements(db, pageQuery);
  let results;
  try {
    results = await db.batch([prepareGroupManagementAuthorizationGuard(db, actor, [group.id]), ...pageStatements]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(403, "GROUP_MANAGEMENT_REQUIRED", "Effective group management permission is required");
    }
    throw error;
  }
  const { rows, total } = decodeOffsetPageResults<UserCatalogRow>(results[1], results[2]);
  return serializeUserCatalogPage(query, rows, total);
}
