import type { MeetingSeriesListQuery } from "../../../../assets/shared/schemas/meeting-calendar";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { SERIES_SELECT_COLUMNS, type SeriesRow } from "./shared";

export type MeetingSeriesListScope =
  | { kind: "admin_consortium" }
  | { kind: "admin_working_group"; workingGroupId: string }
  | { kind: "public_working_group"; workingGroupId: string }
  | { kind: "member"; userId: string };

/**
 * Shared repository query for every paginated meeting-series collection.
 * Scope policy, search, sorting, page rows, and count stay in one contract so
 * public/admin/member endpoints cannot drift or filter a full list in the UI.
 */
export async function queryMeetingSeriesPage(
  db: DatabaseLike,
  query: MeetingSeriesListQuery,
  scope: MeetingSeriesListScope,
): Promise<{ rows: SeriesRow[]; total: number }> {
  const filters: string[] = [];
  const bindings: unknown[] = [];
  let searchColumns: string[] = ["name", "scope_type"];

  switch (scope.kind) {
    case "admin_consortium":
      filters.push("scope_type = 'consortium'");
      break;
    case "admin_working_group":
      filters.push("scope_type = 'working_group'", "working_group_id = ?");
      bindings.push(scope.workingGroupId);
      break;
    case "public_working_group":
      filters.push("scope_type = 'working_group'", "working_group_id = ?", "active = 1");
      bindings.push(scope.workingGroupId);
      searchColumns = ["name"];
      break;
    case "member":
      filters.push(
        "active = 1",
        `(scope_type = 'consortium' OR (scope_type = 'working_group' AND EXISTS (
          SELECT 1 FROM working_group_members wgm
          WHERE wgm.working_group_id = meeting_series.working_group_id
            AND wgm.user_id = ? AND wgm.left_at IS NULL
        )))`,
      );
      bindings.push(scope.userId);
      break;
  }

  const search = query.q ? buildD1TextSearchFilter(query.q, searchColumns) : null;
  if (search) {
    filters.push(search.sql);
    bindings.push(...search.bindings);
  }

  return queryPage<SeriesRow>(db, {
    sql: `SELECT ${SERIES_SELECT_COLUMNS} FROM meeting_series WHERE ${filters.join(" AND ")}`,
    bindings,
    orderBy: resolveMappedOrderBy(
      query.sort,
      { name: "name", scopeType: "scope_type", createdAt: "created_at", updatedAt: "updated_at" },
      "created_at ASC",
      "id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
}
