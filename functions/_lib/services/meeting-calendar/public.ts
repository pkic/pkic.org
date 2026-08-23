/**
 * Public (no auth) WG meeting series listing. Split out of
 * meeting-calendar.ts (PR #1 review).
 */
import { AppError } from "../../errors";
import { getWorkingGroupBySlugOrId } from "../working-groups";
import type { DatabaseLike } from "../../types";
import type { MeetingSeriesListQuery } from "../../../../assets/shared/schemas/meeting-calendar";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryMeetingSeriesPage } from "./series-list";

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

  const { rows, total } = await queryMeetingSeriesPage(db, query, {
    kind: "public_working_group",
    workingGroupId: wg.id,
  });
  const meetingSeries = rows.map((r) => ({ id: r.id, name: r.name }));
  return { meetingSeries, page: buildPageInfo(query.limit, query.offset, total, meetingSeries.length) };
}
