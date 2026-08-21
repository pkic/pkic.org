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

/**
 * Uploads a new ICS file variant: puts the object to R2, then records it in
 * D1. R2 and D1 are not one transaction, so a D1 failure after a successful
 * put is compensated by deleting the just-written object — otherwise it
 * would linger as an orphan no admin surface ever references again (PR #1
 * review §9.2).
 */
export async function uploadIcsFile(
  db: DatabaseLike,
  bucket: R2Bucket,
  seriesId: string,
  expected: { scopeType: MeetingSeriesScopeType; workingGroupId?: string },
  input: { label: string; year: number; buffer: ArrayBuffer; contentType: string; uploadedByUserId: string | null },
): Promise<AdminIcsFileSummary> {
  await getSeriesForAdminOrThrow(db, seriesId, expected);
  const id = uuid();
  const now = nowIso();
  const r2Key = `meeting-ics/${seriesId}/${Date.now()}-${id}.ics`;

  await bucket.put(r2Key, input.buffer, { httpMetadata: { contentType: input.contentType } });

  try {
    await run(
      db,
      `INSERT INTO meeting_ics_files (id, series_id, label, year, r2_key, active, uploaded_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, seriesId, input.label, input.year, r2Key, input.uploadedByUserId, now],
    );
  } catch (error) {
    await bucket.delete(r2Key).catch(() => {});
    throw error;
  }

  return {
    id,
    label: input.label,
    year: input.year,
    r2Key,
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
  const becameInactive = input.active === false && existing.active === 1;
  await db.batch([
    db
      .prepare(`UPDATE meeting_ics_files SET label = COALESCE(?, label), active = COALESCE(?, active) WHERE id = ?`)
      .bind(input.label ?? null, input.active === undefined ? null : input.active ? 1 : 0, fileId),
    ...(becameInactive
      ? [
          db
            .prepare(`UPDATE member_meeting_preferences SET ics_file_id = NULL, updated_at = ? WHERE ics_file_id = ?`)
            .bind(now, fileId),
        ]
      : []),
  ]);

  return toIcsFileSummary({
    ...existing,
    label: input.label ?? existing.label,
    active: input.active === undefined ? existing.active : input.active ? 1 : 0,
  });
}

/**
 * Deletes a single ICS file variant outright — unlike deactivation (which
 * is non-destructive, see updateIcsFile above), this removes the DB row and
 * the R2 object. The two deletes are ordered R2-first, D1-second (the
 * reverse of the original implementation): R2Bucket#delete on a
 * already-missing key is a no-op, not an error, so if this function throws
 * partway through, the D1 row is guaranteed to still exist and a caller can
 * safely retry the whole delete — a retry after D1-first ordering could
 * never reach an object whose row was already gone (PR #1 review §9.2). Any
 * member preference pointing at the file is cleared first, same
 * fallback-to-"all active variants" behavior deactivation already gives.
 */
export async function deleteIcsFile(
  db: DatabaseLike,
  bucket: R2Bucket | undefined,
  seriesId: string,
  fileId: string,
  expected: { scopeType: MeetingSeriesScopeType; workingGroupId?: string },
): Promise<{ r2Key: string }> {
  const existing = await getIcsFileForAdmin(db, seriesId, fileId, expected);

  if (bucket) {
    await bucket.delete(existing.r2_key);
  }

  const now = nowIso();
  await db.batch([
    db
      .prepare(`UPDATE member_meeting_preferences SET ics_file_id = NULL, updated_at = ? WHERE ics_file_id = ?`)
      .bind(now, fileId),
    db.prepare(`DELETE FROM meeting_ics_files WHERE id = ?`).bind(fileId),
  ]);
  return { r2Key: existing.r2_key };
}
