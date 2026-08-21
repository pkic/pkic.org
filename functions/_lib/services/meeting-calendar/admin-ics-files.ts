/**
 * Admin: per-series ICS file variant upload/lookup/update/delete. Split out
 * of meeting-calendar.ts (PR #1 review).
 */
import { first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { AppError } from "../../errors";
import {
  toIcsFileSummary,
  getSeriesForAdminOrThrow,
  ICS_FILE_SELECT_COLUMNS,
  type IcsFileRow,
  type MeetingSeriesScopeType,
  type AdminIcsFileSummary,
} from "./shared";
import type { DatabaseLike } from "../../types";
import { prepareAuditLog, prepareAuditLogAfterOneChange } from "../audit";
import {
  prepareStorageDeletion,
  prepareStorageDeletionCancellation,
  processStorageDeletionForKey,
  registerStorageUploadCompensation,
} from "../storage-deletion-outbox";

/**
 * Uploads a new ICS file variant: puts the object to R2, then records it in
 * D1. R2 and D1 are not one transaction, so a D1 failure after a successful
 * put is protected by a durable cleanup intent for the just-written object;
 * otherwise it would linger as an orphan no admin surface references.
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

  await registerStorageUploadCompensation(db, r2Key, "assets");

  await bucket.put(r2Key, input.buffer, { httpMetadata: { contentType: input.contentType } });

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO meeting_ics_files (id, series_id, label, year, r2_key, active, uploaded_by_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(id, seriesId, input.label, input.year, r2Key, input.uploadedByUserId, now),
      prepareAuditLog(db, "admin", input.uploadedByUserId, "meeting_ics_file_uploaded", "meeting_ics_file", id, {
        seriesId,
        r2Key,
        label: input.label,
        year: input.year,
      }),
      prepareStorageDeletionCancellation(db, r2Key, "assets"),
    ]);
  } catch (error) {
    try {
      await bucket.delete(r2Key);
      await db
        .prepare("DELETE FROM storage_deletion_outbox WHERE bucket = 'assets' AND object_key = ?")
        .bind(r2Key)
        .run();
    } catch {
      // The pre-upload deletion intent remains durable for scheduled retry.
    }
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
  const row = await first<IcsFileRow>(
    db,
    `SELECT ${ICS_FILE_SELECT_COLUMNS}
       FROM meeting_ics_files WHERE id = ? AND series_id = ?`,
    [fileId, seriesId],
  );
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
  actorId: string,
): Promise<AdminIcsFileSummary> {
  const existing = await getIcsFileForAdmin(db, seriesId, fileId, expected);
  const now = nowIso();
  const becameInactive = input.active === false && existing.active === 1;
  await db.batch([
    db
      .prepare(`UPDATE meeting_ics_files SET label = COALESCE(?, label), active = COALESCE(?, active) WHERE id = ?`)
      .bind(input.label ?? null, input.active === undefined ? null : input.active ? 1 : 0, fileId),
    prepareAuditLogAfterOneChange(db, "admin", actorId, "meeting_ics_file_updated", "meeting_ics_file", fileId, {
      seriesId,
      label: input.label,
      active: input.active,
    }),
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
 * the R2 object. The D1 mutation, audit, and durable deletion intent commit
 * atomically before the best-effort R2 deletion. A failed R2 call leaves the
 * outbox row retryable, so the object is not orphaned after its calendar row
 * is removed. Any member preference pointing at the file is cleared in the
 * same transaction.
 */
export async function deleteIcsFile(
  db: DatabaseLike,
  bucket: R2Bucket | undefined,
  seriesId: string,
  fileId: string,
  expected: { scopeType: MeetingSeriesScopeType; workingGroupId?: string },
  actorId: string | null = null,
): Promise<{ r2Key: string }> {
  const existing = await getIcsFileForAdmin(db, seriesId, fileId, expected);

  const now = nowIso();
  const deletion = prepareStorageDeletion(db, existing.r2_key, now, "assets");
  await db.batch([
    db
      .prepare(`UPDATE member_meeting_preferences SET ics_file_id = NULL, updated_at = ? WHERE ics_file_id = ?`)
      .bind(now, fileId),
    db.prepare(`DELETE FROM meeting_ics_files WHERE id = ?`).bind(fileId),
    prepareAuditLogAfterOneChange(db, "admin", actorId, "meeting_ics_file_deleted", "meeting_ics_file", fileId, {
      scopeType: expected.scopeType,
      workingGroupId: expected.workingGroupId,
      seriesId,
      r2Key: existing.r2_key,
    }),
    ...(deletion ? [deletion] : []),
  ]);
  if (bucket) {
    await processStorageDeletionForKey(
      db,
      { ASSETS_BUCKET: bucket, SPEAKER_UPLOADS_BUCKET: undefined },
      existing.r2_key,
      "assets",
    );
  }
  return { r2Key: existing.r2_key };
}
