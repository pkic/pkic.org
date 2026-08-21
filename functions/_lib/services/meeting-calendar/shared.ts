/**
 * Meeting calendar — shared row types and
 * repository/formatting primitives used across the other
 * meeting-calendar/*.ts modules. Split out of a single 715-line
 * meeting-calendar.ts (PR #1 review) — see meeting-calendar/index.ts for the
 * barrel that re-exports everything under the original module surface.
 */
import { all, first } from "../../db/queries";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";

export type MeetingSeriesScopeType = "consortium" | "working_group";

export interface SeriesRow {
  id: string;
  name: string;
  scope_type: MeetingSeriesScopeType;
  working_group_id: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface IcsFileRow {
  id: string;
  series_id: string;
  label: string;
  year: number;
  r2_key: string;
  active: number;
  uploaded_by_user_id: string | null;
  created_at: string;
}

export interface PreferenceRow {
  id: string;
  user_id: string;
  series_id: string;
  ics_file_id: string | null;
  set_at: string;
  updated_at: string;
}

export const SERIES_SELECT_COLUMNS = "id, name, scope_type, working_group_id, active, created_at, updated_at";
export const ICS_FILE_SELECT_COLUMNS = "id, series_id, label, year, r2_key, active, uploaded_by_user_id, created_at";
export const PREFERENCE_SELECT_COLUMNS = "id, user_id, series_id, ics_file_id, set_at, updated_at";

export interface AdminIcsFileSummary {
  id: string;
  label: string;
  year: number;
  r2Key: string;
  active: boolean;
  uploadedByUserId: string | null;
  createdAt: string;
}

export interface AdminMeetingSeriesSummary {
  id: string;
  name: string;
  scopeType: MeetingSeriesScopeType;
  workingGroupId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  icsFiles: AdminIcsFileSummary[];
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function icsFilename(seriesName: string, label: string, year: number): string {
  return `${slugify(seriesName)}-${slugify(label)}-${year}.ics`;
}

export function toIcsFileSummary(row: IcsFileRow): AdminIcsFileSummary {
  return {
    id: row.id,
    label: row.label,
    year: row.year,
    r2Key: row.r2_key,
    active: row.active === 1,
    uploadedByUserId: row.uploaded_by_user_id,
    createdAt: row.created_at,
  };
}

export async function attachIcsFiles(db: DatabaseLike, seriesRows: SeriesRow[]): Promise<AdminMeetingSeriesSummary[]> {
  if (seriesRows.length === 0) return [];
  const seriesFilter = buildD1JsonMembershipFilter(
    "series_id",
    seriesRows.map((series) => series.id),
  );
  const icsRows = await all<IcsFileRow>(
    db,
    `SELECT ${ICS_FILE_SELECT_COLUMNS} FROM meeting_ics_files
      WHERE ${seriesFilter.sql} ORDER BY year DESC, label ASC, id ASC`,
    seriesFilter.bindings,
  );
  const bySeriesId = new Map<string, AdminIcsFileSummary[]>();
  for (const row of icsRows) {
    const list = bySeriesId.get(row.series_id) ?? [];
    list.push(toIcsFileSummary(row));
    bySeriesId.set(row.series_id, list);
  }
  return seriesRows.map((s) => ({
    id: s.id,
    name: s.name,
    scopeType: s.scope_type,
    workingGroupId: s.working_group_id,
    active: s.active === 1,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    icsFiles: bySeriesId.get(s.id) ?? [],
  }));
}

export async function getSeriesForAdminOrThrow(
  db: DatabaseLike,
  seriesId: string,
  expected: { scopeType: MeetingSeriesScopeType; workingGroupId?: string },
): Promise<SeriesRow> {
  const row = await first<SeriesRow>(db, `SELECT ${SERIES_SELECT_COLUMNS} FROM meeting_series WHERE id = ?`, [
    seriesId,
  ]);
  if (!row || row.scope_type !== expected.scopeType) {
    throw new AppError(404, "MEETING_SERIES_NOT_FOUND", "Meeting series not found");
  }
  if (expected.workingGroupId && row.working_group_id !== expected.workingGroupId) {
    throw new AppError(404, "MEETING_SERIES_NOT_FOUND", "Meeting series not found");
  }
  return row;
}
