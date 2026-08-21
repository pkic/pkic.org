/**
 * Public (no auth) WG meeting series listing. Split out of
 * meeting-calendar.ts (PR #1 review).
 */
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import { getWorkingGroupBySlugOrId } from "../working-groups";
import { SERIES_SELECT_COLUMNS, type SeriesRow } from "./shared";
import type { DatabaseLike } from "../../types";

export interface PublicMeetingSeries {
  id: string;
  name: string;
}

export async function listPublicMeetingSeriesForWg(
  db: DatabaseLike,
  wgIdOrSlug: string,
): Promise<PublicMeetingSeries[]> {
  const wg = await getWorkingGroupBySlugOrId(db, wgIdOrSlug);
  if (!wg) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");

  const rows = await all<SeriesRow>(
    db,
    `SELECT ${SERIES_SELECT_COLUMNS} FROM meeting_series
      WHERE scope_type = 'working_group' AND working_group_id = ? AND active = 1
      ORDER BY created_at ASC, id ASC`,
    [wg.id],
  );
  return rows.map((r) => ({ id: r.id, name: r.name }));
}
