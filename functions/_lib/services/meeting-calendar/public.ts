/**
 * Public (no auth) WG meeting series listing. Split out of
 * meeting-calendar.ts (PR #1 review).
 */
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import { getWorkingGroupBySlugOrId } from "../working-groups";
import { SERIES_SELECT_COLUMNS, type SeriesRow } from "./shared";
import type { DatabaseLike } from "../../types";
import type { MeetingSeriesListQuery } from "../../../../assets/shared/schemas/meeting-calendar";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";

export interface PublicMeetingSeries {
  id: string;
  name: string;
}

export async function listPublicMeetingSeriesForWg(
  db: DatabaseLike,
  wgIdOrSlug: string,
  query: MeetingSeriesListQuery,
): Promise<{ meetingSeries: PublicMeetingSeries[]; page: ReturnType<typeof buildPageInfo> }> {
  const wg = await getWorkingGroupBySlugOrId(db, wgIdOrSlug);
  if (!wg || wg.active !== 1) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");

  const search = query.q ? buildD1TextSearchFilter(query.q, ["name"]) : null;
  const filters = ["scope_type = 'working_group'", "working_group_id = ?", "active = 1"];
  const bindings: unknown[] = [wg.id];
  if (search) {
    filters.push(search.sql);
    bindings.push(...search.bindings);
  }
  const orderBy = resolveMappedOrderBy(
    query.sort,
    { name: "name", scopeType: "scope_type", createdAt: "created_at", updatedAt: "updated_at" },
    "created_at ASC",
    "id ASC",
  );
  const { rows, total } = await queryPage<SeriesRow>(db, {
    sql: `SELECT ${SERIES_SELECT_COLUMNS} FROM meeting_series WHERE ${filters.join(" AND ")}`,
    bindings,
    orderBy,
    limit: query.limit,
    offset: query.offset,
  });
  const meetingSeries = rows.map((r) => ({ id: r.id, name: r.name }));
  return { meetingSeries, page: buildPageInfo(query.limit, query.offset, total, meetingSeries.length) };
}
