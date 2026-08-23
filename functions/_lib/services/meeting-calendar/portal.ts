/**
 * Member self-service ("My Account → Calendar Invites"). Split out of
 * meeting-calendar.ts.
 */
import { all, first, run } from "../../db/queries";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { AppError } from "../../errors";
import {
  ICS_FILE_SELECT_COLUMNS,
  PREFERENCE_SELECT_COLUMNS,
  SERIES_SELECT_COLUMNS,
  type SeriesRow,
  type IcsFileRow,
  type PreferenceRow,
  type MeetingSeriesScopeType,
} from "./shared";
import type { AuthMember, DatabaseLike } from "../../types";
import type { MeetingSeriesListQuery } from "../../../../assets/shared/schemas/meeting-calendar";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryMeetingSeriesPage } from "./series-list";

export interface MyMeetingSeriesIcsFile {
  id: string;
  label: string;
  year: number;
}

export interface MyMeetingSeries {
  id: string;
  name: string;
  scopeType: MeetingSeriesScopeType;
  icsFiles: MyMeetingSeriesIcsFile[];
  preferenceIcsFileId: string | null;
}

export async function listMyMeetingSeries(
  db: DatabaseLike,
  member: AuthMember,
  query: MeetingSeriesListQuery,
): Promise<{ meetingSeries: MyMeetingSeries[]; page: ReturnType<typeof buildPageInfo> }> {
  const { rows: seriesRows, total } = await queryMeetingSeriesPage(db, query, {
    kind: "member",
    userId: member.userId,
  });
  if (seriesRows.length === 0) {
    return { meetingSeries: [], page: buildPageInfo(query.limit, query.offset, total, 0) };
  }

  const seriesIds = seriesRows.map((s) => s.id);
  const seriesFilter = buildD1JsonMembershipFilter("series_id", seriesIds);

  const icsRows = await all<IcsFileRow>(
    db,
    `SELECT ${ICS_FILE_SELECT_COLUMNS} FROM meeting_ics_files
      WHERE active = 1 AND ${seriesFilter.sql} ORDER BY year DESC, label ASC, id ASC`,
    seriesFilter.bindings,
  );
  const icsBySeriesId = new Map<string, MyMeetingSeriesIcsFile[]>();
  for (const row of icsRows) {
    const list = icsBySeriesId.get(row.series_id) ?? [];
    list.push({ id: row.id, label: row.label, year: row.year });
    icsBySeriesId.set(row.series_id, list);
  }

  const prefRows = await all<PreferenceRow>(
    db,
    `SELECT ${PREFERENCE_SELECT_COLUMNS} FROM member_meeting_preferences
      WHERE user_id = ? AND ${seriesFilter.sql}`,
    [member.userId, ...seriesFilter.bindings],
  );
  const prefBySeriesId = new Map(prefRows.map((p) => [p.series_id, p.ics_file_id]));

  const meetingSeries = seriesRows.map((s) => ({
    id: s.id,
    name: s.name,
    scopeType: s.scope_type,
    icsFiles: icsBySeriesId.get(s.id) ?? [],
    preferenceIcsFileId: prefBySeriesId.get(s.id) ?? null,
  }));
  return { meetingSeries, page: buildPageInfo(query.limit, query.offset, total, meetingSeries.length) };
}

async function assertSeriesApplicableToMember(
  db: DatabaseLike,
  member: AuthMember,
  seriesId: string,
): Promise<SeriesRow> {
  const series = await first<SeriesRow>(
    db,
    `SELECT ${SERIES_SELECT_COLUMNS} FROM meeting_series WHERE id = ? AND active = 1`,
    [seriesId],
  );
  if (!series) throw new AppError(404, "MEETING_SERIES_NOT_FOUND", "Meeting series not found");

  if (series.scope_type === "consortium") return series;

  const membership = await first<{ id: string }>(
    db,
    `SELECT id FROM working_group_members WHERE working_group_id = ? AND user_id = ? AND left_at IS NULL`,
    [series.working_group_id, member.userId],
  );
  if (!membership) throw new AppError(403, "NOT_A_MEMBER_OF_SERIES_WG", "Not a member of this series' working group");
  return series;
}

export async function setMyMeetingPreference(
  db: DatabaseLike,
  member: AuthMember,
  seriesId: string,
  icsFileId: string | null,
): Promise<void> {
  await assertSeriesApplicableToMember(db, member, seriesId);

  if (icsFileId !== null) {
    const file = await first<{ id: string }>(
      db,
      `SELECT id FROM meeting_ics_files WHERE id = ? AND series_id = ? AND active = 1`,
      [icsFileId, seriesId],
    );
    if (!file) throw new AppError(404, "ICS_FILE_NOT_FOUND", "ICS file not found for this series");
  }

  const now = nowIso();
  await run(
    db,
    `INSERT INTO member_meeting_preferences (id, user_id, series_id, ics_file_id, set_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, series_id) DO UPDATE SET
       ics_file_id = excluded.ics_file_id,
       updated_at  = excluded.updated_at`,
    [uuid(), member.userId, seriesId, icsFileId, now, now],
  );
}

export async function getMyIcsFileForDownload(
  db: DatabaseLike,
  member: AuthMember,
  seriesId: string,
  icsFileId: string,
): Promise<IcsFileRow> {
  await assertSeriesApplicableToMember(db, member, seriesId);
  const file = await first<IcsFileRow>(
    db,
    `SELECT ${ICS_FILE_SELECT_COLUMNS} FROM meeting_ics_files
      WHERE id = ? AND series_id = ? AND active = 1`,
    [icsFileId, seriesId],
  );
  if (!file) throw new AppError(404, "ICS_FILE_NOT_FOUND", "ICS file not found for this series");
  return file;
}
