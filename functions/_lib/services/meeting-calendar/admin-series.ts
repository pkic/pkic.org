/**
 * Admin: meeting series CRUD (consortium- and working-group-scoped) and
 * cascading series deletion. Split out of meeting-calendar.ts (PR #1
 * review).
 */
import { all } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { AppError } from "../../errors";
import { getWorkingGroupBySlugOrId } from "../working-groups";
import {
  attachIcsFiles,
  getSeriesForAdminOrThrow,
  ICS_FILE_SELECT_COLUMNS,
  SERIES_SELECT_COLUMNS,
  type SeriesRow,
  type IcsFileRow,
  type MeetingSeriesScopeType,
  type AdminMeetingSeriesSummary,
} from "./shared";
import type { DatabaseLike } from "../../types";
import { prepareAuditLog, prepareAuditLogAfterOneChange } from "../audit";
import { prepareStorageDeletion, processStorageDeletionForKey } from "../storage-deletion-outbox";

// ── Admin: working-group-scoped meeting series ───────────────────────────

export async function listAdminMeetingSeriesForWg(
  db: DatabaseLike,
  wgIdOrSlug: string,
): Promise<AdminMeetingSeriesSummary[]> {
  const wg = await getWorkingGroupBySlugOrId(db, wgIdOrSlug);
  if (!wg) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");

  const rows = await all<SeriesRow>(
    db,
    `SELECT ${SERIES_SELECT_COLUMNS} FROM meeting_series
      WHERE scope_type = 'working_group' AND working_group_id = ?
      ORDER BY created_at ASC, id ASC`,
    [wg.id],
  );
  return attachIcsFiles(db, rows);
}

export async function createWgMeetingSeries(
  db: DatabaseLike,
  workingGroupId: string,
  input: { name: string },
  actorId: string,
): Promise<AdminMeetingSeriesSummary> {
  const wg = await getWorkingGroupBySlugOrId(db, workingGroupId);
  if (!wg) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");

  const id = uuid();
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO meeting_series (id, name, scope_type, working_group_id, active, created_at, updated_at)
         VALUES (?, ?, 'working_group', ?, 1, ?, ?)`,
      )
      .bind(id, input.name, wg.id, now, now),
    prepareAuditLog(db, "admin", actorId, "meeting_series_created", "meeting_series", id, {
      scopeType: "working_group",
      workingGroupId: wg.id,
      name: input.name,
    }),
  ]);
  const [summary] = await attachIcsFiles(db, [
    {
      id,
      name: input.name,
      scope_type: "working_group",
      working_group_id: wg.id,
      active: 1,
      created_at: now,
      updated_at: now,
    },
  ]);
  return summary;
}

// ── Admin: consortium-scoped meeting series ──────────────────────────────

export async function listAdminConsortiumMeetingSeries(db: DatabaseLike): Promise<AdminMeetingSeriesSummary[]> {
  const rows = await all<SeriesRow>(
    db,
    `SELECT ${SERIES_SELECT_COLUMNS} FROM meeting_series
      WHERE scope_type = 'consortium' ORDER BY created_at ASC, id ASC`,
  );
  return attachIcsFiles(db, rows);
}

export async function createConsortiumMeetingSeries(
  db: DatabaseLike,
  input: { name: string },
  actorId: string,
): Promise<AdminMeetingSeriesSummary> {
  const id = uuid();
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO meeting_series (id, name, scope_type, working_group_id, active, created_at, updated_at)
         VALUES (?, ?, 'consortium', NULL, 1, ?, ?)`,
      )
      .bind(id, input.name, now, now),
    prepareAuditLog(db, "admin", actorId, "meeting_series_created", "meeting_series", id, {
      scopeType: "consortium",
      name: input.name,
    }),
  ]);
  const [summary] = await attachIcsFiles(db, [
    {
      id,
      name: input.name,
      scope_type: "consortium",
      working_group_id: null,
      active: 1,
      created_at: now,
      updated_at: now,
    },
  ]);
  return summary;
}

// ── Admin: shared series operations (scope-checked by caller) ───────────

export async function updateMeetingSeries(
  db: DatabaseLike,
  seriesId: string,
  expected: { scopeType: MeetingSeriesScopeType; workingGroupId?: string },
  input: { name?: string; active?: boolean },
  actorId: string,
): Promise<AdminMeetingSeriesSummary> {
  const existing = await getSeriesForAdminOrThrow(db, seriesId, expected);
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE meeting_series SET name = COALESCE(?, name), active = COALESCE(?, active), updated_at = ? WHERE id = ?`,
      )
      .bind(input.name ?? null, input.active === undefined ? null : input.active ? 1 : 0, now, seriesId),
    prepareAuditLogAfterOneChange(db, "admin", actorId, "meeting_series_updated", "meeting_series", seriesId, {
      scopeType: expected.scopeType,
      workingGroupId: expected.workingGroupId,
      name: input.name,
      active: input.active,
    }),
  ]);
  const updated = {
    ...existing,
    name: input.name ?? existing.name,
    active: input.active === undefined ? existing.active : input.active ? 1 : 0,
    updated_at: now,
  };
  const [summary] = await attachIcsFiles(db, [updated]);
  return summary;
}

/**
 * Deletes a meeting series and everything under it — the ICS file R2
 * objects, their D1 rows, and any member time-slot preferences pointing at
 * either the series or one of its files. FK constraints on
 * meeting_ics_files/member_meeting_preferences are enforced in this
 * codebase's D1 (see consolidated migration 0035 PRAGMA foreign_keys = ON), so
 * children must go first there too.
 *
 * D1 is the source of truth: preferences, file rows, the series, audit, and
 * durable storage-deletion intents commit atomically. R2 deletion is then
 * attempted opportunistically; any failure remains recoverable through the
 * outbox without restoring already-deleted calendar data.
 */
export async function deleteMeetingSeries(
  db: DatabaseLike,
  bucket: R2Bucket | undefined,
  seriesId: string,
  expected: { scopeType: MeetingSeriesScopeType; workingGroupId?: string },
  actorId: string | null = null,
): Promise<{ deletedIcsFileR2Keys: string[] }> {
  await getSeriesForAdminOrThrow(db, seriesId, expected);
  const icsRows = await all<IcsFileRow>(
    db,
    `SELECT ${ICS_FILE_SELECT_COLUMNS}
       FROM meeting_ics_files WHERE series_id = ? ORDER BY r2_key, id`,
    [seriesId],
  );
  const at = nowIso();
  const deletionStatements = icsRows.flatMap((row) => {
    const statement = prepareStorageDeletion(db, row.r2_key, at, "assets");
    return statement ? [statement] : [];
  });
  await db.batch([
    db.prepare(`DELETE FROM member_meeting_preferences WHERE series_id = ?`).bind(seriesId),
    ...deletionStatements,
    db.prepare(`DELETE FROM meeting_ics_files WHERE series_id = ?`).bind(seriesId),
    db.prepare(`DELETE FROM meeting_series WHERE id = ?`).bind(seriesId),
    prepareAuditLogAfterOneChange(db, "admin", actorId, "meeting_series_deleted", "meeting_series", seriesId, {
      scopeType: expected.scopeType,
      workingGroupId: expected.workingGroupId,
      r2Keys: icsRows.map((row) => row.r2_key),
    }),
  ]);
  if (bucket) {
    for (const row of icsRows) {
      await processStorageDeletionForKey(
        db,
        { ASSETS_BUCKET: bucket, SPEAKER_UPLOADS_BUCKET: undefined },
        row.r2_key,
        "assets",
      );
    }
  }
  return { deletedIcsFileR2Keys: icsRows.map((r) => r.r2_key) };
}
