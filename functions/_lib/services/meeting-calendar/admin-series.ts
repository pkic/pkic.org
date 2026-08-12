/**
 * Admin: meeting series CRUD (consortium- and working-group-scoped) and
 * cascading series deletion. Split out of meeting-calendar.ts (PR #1
 * review).
 */
import { all, run } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { AppError } from "../../errors";
import { getWorkingGroupBySlugOrId } from "../working-groups";
import {
  attachIcsFiles,
  getSeriesForAdminOrThrow,
  type SeriesRow,
  type IcsFileRow,
  type MeetingSeriesScopeType,
  type AdminMeetingSeriesSummary,
} from "./shared";
import type { DatabaseLike } from "../../types";

// ── Admin: working-group-scoped meeting series ───────────────────────────

export async function listAdminMeetingSeriesForWg(
  db: DatabaseLike,
  wgIdOrSlug: string,
): Promise<AdminMeetingSeriesSummary[]> {
  const wg = await getWorkingGroupBySlugOrId(db, wgIdOrSlug);
  if (!wg) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");

  const rows = await all<SeriesRow>(
    db,
    `SELECT * FROM meeting_series WHERE scope_type = 'working_group' AND working_group_id = ? ORDER BY created_at ASC`,
    [wg.id],
  );
  return attachIcsFiles(db, rows);
}

export async function createWgMeetingSeries(
  db: DatabaseLike,
  workingGroupId: string,
  input: { name: string },
): Promise<AdminMeetingSeriesSummary> {
  const wg = await getWorkingGroupBySlugOrId(db, workingGroupId);
  if (!wg) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");

  const id = uuid();
  const now = nowIso();
  await run(
    db,
    `INSERT INTO meeting_series (id, name, scope_type, working_group_id, active, created_at, updated_at)
     VALUES (?, ?, 'working_group', ?, 1, ?, ?)`,
    [id, input.name, wg.id, now, now],
  );
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
    `SELECT * FROM meeting_series WHERE scope_type = 'consortium' ORDER BY created_at ASC`,
  );
  return attachIcsFiles(db, rows);
}

export async function createConsortiumMeetingSeries(
  db: DatabaseLike,
  input: { name: string },
): Promise<AdminMeetingSeriesSummary> {
  const id = uuid();
  const now = nowIso();
  await run(
    db,
    `INSERT INTO meeting_series (id, name, scope_type, working_group_id, active, created_at, updated_at)
     VALUES (?, ?, 'consortium', NULL, 1, ?, ?)`,
    [id, input.name, now, now],
  );
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
): Promise<AdminMeetingSeriesSummary> {
  const existing = await getSeriesForAdminOrThrow(db, seriesId, expected);
  const now = nowIso();
  await run(
    db,
    `UPDATE meeting_series SET name = COALESCE(?, name), active = COALESCE(?, active), updated_at = ? WHERE id = ?`,
    [input.name ?? null, input.active === undefined ? null : input.active ? 1 : 0, now, seriesId],
  );
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
 * Deletes a meeting series and everything under it — the ICS file rows and
 * any member time-slot preferences pointing at either the series or one of
 * its files. FK constraints on meeting_ics_files/member_meeting_preferences
 * are enforced in this codebase's D1 (see migrations 0035/0036 PRAGMA
 * foreign_keys = ON), so children must go first. Returns the R2 keys of the
 * deleted ICS files so the route handler can also delete those objects —
 * this service stays R2-agnostic like the rest of this module (no env here).
 */
export async function deleteMeetingSeries(
  db: DatabaseLike,
  seriesId: string,
  expected: { scopeType: MeetingSeriesScopeType; workingGroupId?: string },
): Promise<{ deletedIcsFileR2Keys: string[] }> {
  await getSeriesForAdminOrThrow(db, seriesId, expected);
  const icsRows = await all<IcsFileRow>(db, `SELECT * FROM meeting_ics_files WHERE series_id = ?`, [seriesId]);
  await run(db, `DELETE FROM member_meeting_preferences WHERE series_id = ?`, [seriesId]);
  await run(db, `DELETE FROM meeting_ics_files WHERE series_id = ?`, [seriesId]);
  await run(db, `DELETE FROM meeting_series WHERE id = ?`, [seriesId]);
  return { deletedIcsFileR2Keys: icsRows.map((r) => r.r2_key) };
}
