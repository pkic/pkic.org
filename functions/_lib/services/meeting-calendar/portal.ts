/**
 * Member self-service ("My Account → Calendar Invites"). Split out of
 * meeting-calendar.ts.
 */
import { all, first, run } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { AppError } from "../../errors";
import type { SeriesRow, IcsFileRow, PreferenceRow, MeetingSeriesScopeType } from "./shared";
import type { AuthMember, DatabaseLike } from "../../types";

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

async function myApplicableSeriesRows(db: DatabaseLike, member: AuthMember): Promise<SeriesRow[]> {
  const consortiumSeries = await all<SeriesRow>(
    db,
    `SELECT * FROM meeting_series WHERE scope_type = 'consortium' AND active = 1`,
  );

  const wgRows = await all<{ working_group_id: string }>(
    db,
    `SELECT wg.id AS working_group_id
     FROM working_group_members wgm JOIN working_groups wg ON wg.id = wgm.working_group_id
     WHERE wgm.user_id = ? AND wgm.left_at IS NULL`,
    [member.userId],
  );
  const wgIds = wgRows.map((r) => r.working_group_id);

  let wgSeries: SeriesRow[] = [];
  if (wgIds.length > 0) {
    const placeholders = wgIds.map(() => "?").join(", ");
    wgSeries = await all<SeriesRow>(
      db,
      `SELECT * FROM meeting_series WHERE scope_type = 'working_group' AND active = 1 AND working_group_id IN (${placeholders})`,
      wgIds,
    );
  }

  return [...consortiumSeries, ...wgSeries];
}

export async function listMyMeetingSeries(db: DatabaseLike, member: AuthMember): Promise<MyMeetingSeries[]> {
  const seriesRows = await myApplicableSeriesRows(db, member);
  if (seriesRows.length === 0) return [];

  const placeholders = seriesRows.map(() => "?").join(", ");
  const seriesIds = seriesRows.map((s) => s.id);

  const icsRows = await all<IcsFileRow>(
    db,
    `SELECT * FROM meeting_ics_files WHERE active = 1 AND series_id IN (${placeholders}) ORDER BY year DESC, label ASC`,
    seriesIds,
  );
  const icsBySeriesId = new Map<string, MyMeetingSeriesIcsFile[]>();
  for (const row of icsRows) {
    const list = icsBySeriesId.get(row.series_id) ?? [];
    list.push({ id: row.id, label: row.label, year: row.year });
    icsBySeriesId.set(row.series_id, list);
  }

  const prefRows = await all<PreferenceRow>(
    db,
    `SELECT * FROM member_meeting_preferences WHERE user_id = ? AND series_id IN (${placeholders})`,
    [member.userId, ...seriesIds],
  );
  const prefBySeriesId = new Map(prefRows.map((p) => [p.series_id, p.ics_file_id]));

  return seriesRows.map((s) => ({
    id: s.id,
    name: s.name,
    scopeType: s.scope_type,
    icsFiles: icsBySeriesId.get(s.id) ?? [],
    preferenceIcsFileId: prefBySeriesId.get(s.id) ?? null,
  }));
}

async function assertSeriesApplicableToMember(
  db: DatabaseLike,
  member: AuthMember,
  seriesId: string,
): Promise<SeriesRow> {
  const series = await first<SeriesRow>(db, `SELECT * FROM meeting_series WHERE id = ? AND active = 1`, [seriesId]);
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
    `SELECT * FROM meeting_ics_files WHERE id = ? AND series_id = ? AND active = 1`,
    [icsFileId, seriesId],
  );
  if (!file) throw new AppError(404, "ICS_FILE_NOT_FOUND", "ICS file not found for this series");
  return file;
}
