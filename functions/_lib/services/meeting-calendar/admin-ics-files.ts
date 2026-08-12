/**
 * Admin: per-series ICS file variant upload/lookup/update/delete. Split out
 * of meeting-calendar.ts (PR #1 review).
 */
import { first, run } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { AppError } from "../../errors";
import {
  toIcsFileSummary,
  getSeriesForAdminOrThrow,
  type IcsFileRow,
  type MeetingSeriesScopeType,
  type AdminIcsFileSummary,
} from "./shared";
import type { DatabaseLike } from "../../types";

export async function uploadIcsFile(
  db: DatabaseLike,
  seriesId: string,
  expected: { scopeType: MeetingSeriesScopeType; workingGroupId?: string },
  input: { label: string; year: number; r2Key: string; uploadedByUserId: string | null },
): Promise<AdminIcsFileSummary> {
  await getSeriesForAdminOrThrow(db, seriesId, expected);
  const id = uuid();
  const now = nowIso();
  await run(
    db,
    `INSERT INTO meeting_ics_files (id, series_id, label, year, r2_key, active, uploaded_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    [id, seriesId, input.label, input.year, input.r2Key, input.uploadedByUserId, now],
  );
  return {
    id,
    label: input.label,
    year: input.year,
    r2Key: input.r2Key,
    active: true,
    uploadedByUserId: input.uploadedByUserId,
    createdAt: now,
  };
}

export async function getIcsFileForAdmin(
  db: DatabaseLike,
  seriesId: string,
  fileId: string,
  expected: { scopeType: MeetingSeriesScopeType; workingGroupId?: string },
): Promise<IcsFileRow> {
  await getSeriesForAdminOrThrow(db, seriesId, expected);
  const row = await first<IcsFileRow>(db, `SELECT * FROM meeting_ics_files WHERE id = ? AND series_id = ?`, [
    fileId,
    seriesId,
  ]);
  if (!row) throw new AppError(404, "ICS_FILE_NOT_FOUND", "ICS file not found");
  return row;
}

/**
 * Updates a file's label/active status. Deactivation is
 * non-destructive — the R2 object is retained, only `active` flips to 0 —
 * and clears any member preference pointing to it, so the next resend
 * falls back to "all active variants" for those members automatically.
 */
export async function updateIcsFile(
  db: DatabaseLike,
  seriesId: string,
  fileId: string,
  expected: { scopeType: MeetingSeriesScopeType; workingGroupId?: string },
  input: { label?: string; active?: boolean },
): Promise<AdminIcsFileSummary> {
  const existing = await getIcsFileForAdmin(db, seriesId, fileId, expected);
  const now = nowIso();
  await run(db, `UPDATE meeting_ics_files SET label = COALESCE(?, label), active = COALESCE(?, active) WHERE id = ?`, [
    input.label ?? null,
    input.active === undefined ? null : input.active ? 1 : 0,
    fileId,
  ]);

  const becameInactive = input.active === false && existing.active === 1;
  if (becameInactive) {
    await run(db, `UPDATE member_meeting_preferences SET ics_file_id = NULL, updated_at = ? WHERE ics_file_id = ?`, [
      now,
      fileId,
    ]);
  }

  return toIcsFileSummary({
    ...existing,
    label: input.label ?? existing.label,
    active: input.active === undefined ? existing.active : input.active ? 1 : 0,
  });
}

/**
 * Deletes a single ICS file variant outright — unlike deactivation (which
 * is non-destructive, see updateIcsFile above), this removes the DB row
 * entirely so the route handler can also delete the R2 object. Any member
 * preference pointing at it is cleared first, same fallback-to-"all active
 * variants" behavior deactivation already gives.
 */
export async function deleteIcsFile(
  db: DatabaseLike,
  seriesId: string,
  fileId: string,
  expected: { scopeType: MeetingSeriesScopeType; workingGroupId?: string },
): Promise<{ r2Key: string }> {
  const existing = await getIcsFileForAdmin(db, seriesId, fileId, expected);
  const now = nowIso();
  await run(db, `UPDATE member_meeting_preferences SET ics_file_id = NULL, updated_at = ? WHERE ics_file_id = ?`, [
    now,
    fileId,
  ]);
  await run(db, `DELETE FROM meeting_ics_files WHERE id = ?`, [fileId]);
  return { r2Key: existing.r2_key };
}
