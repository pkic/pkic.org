/**
 * Meeting calendar management (PRD §4.12, Phase 4D). Replaces the static
 * ICS files committed to `pkic/members` with portal-managed meeting series
 * and R2-backed ICS file variants, member time-slot preferences, and
 * "smart-routed" bulk resend.
 *
 * No dedicated notifications table/UI exists anywhere in this codebase yet
 * (same backend-first split every prior phase used for its own gaps) — the
 * PRD's "cleared with a portal notification prompting them to re-select" is
 * satisfied by clearing the preference row itself (deactivateIcsFile
 * below); the next `GET /me/calendar` call naturally reflects "no
 * preference" for that series. There is no member-facing Hugo page calling
 * that endpoint yet either, so there's nothing to render a banner in.
 */
import { all, first, run } from "../db/queries";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { AppError } from "../errors";
import { getWorkingGroupBySlugOrId } from "./working-groups";
import type { AuthMember, DatabaseLike } from "../types";
import type { QueuedIcsFileAttachment } from "../email/attachments";
import { buildIcsFileAttachment } from "../email/attachments";

export type MeetingSeriesScopeType = "consortium" | "working_group";

interface SeriesRow {
  id: string;
  name: string;
  scope_type: MeetingSeriesScopeType;
  working_group_id: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

interface IcsFileRow {
  id: string;
  series_id: string;
  label: string;
  year: number;
  r2_key: string;
  active: number;
  uploaded_by_user_id: string | null;
  created_at: string;
}

interface PreferenceRow {
  id: string;
  user_id: string;
  series_id: string;
  ics_file_id: string | null;
  set_at: string;
  updated_at: string;
}

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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toIcsFileSummary(row: IcsFileRow): AdminIcsFileSummary {
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

async function attachIcsFiles(db: DatabaseLike, seriesRows: SeriesRow[]): Promise<AdminMeetingSeriesSummary[]> {
  if (seriesRows.length === 0) return [];
  const placeholders = seriesRows.map(() => "?").join(", ");
  const icsRows = await all<IcsFileRow>(
    db,
    `SELECT * FROM meeting_ics_files WHERE series_id IN (${placeholders}) ORDER BY year DESC, label ASC`,
    seriesRows.map((s) => s.id),
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

// ── Admin: shared series/ICS-file operations (scope-checked by caller) ───

async function getSeriesForAdminOrThrow(
  db: DatabaseLike,
  seriesId: string,
  expected: { scopeType: MeetingSeriesScopeType; workingGroupId?: string },
): Promise<SeriesRow> {
  const row = await first<SeriesRow>(db, `SELECT * FROM meeting_series WHERE id = ?`, [seriesId]);
  if (!row || row.scope_type !== expected.scopeType) {
    throw new AppError(404, "MEETING_SERIES_NOT_FOUND", "Meeting series not found");
  }
  if (expected.workingGroupId && row.working_group_id !== expected.workingGroupId) {
    throw new AppError(404, "MEETING_SERIES_NOT_FOUND", "Meeting series not found");
  }
  return row;
}

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
 * Updates a file's label/active status. Deactivation (§4.12) is
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
 * Deletes a meeting series and everything under it — the ICS file rows and
 * any member time-slot preferences pointing at either the series or one of
 * its files. FK constraints on meeting_ics_files/member_meeting_preferences
 * are enforced in this codebase's D1 (see migrations 0035/0036 PRAGMA
 * foreign_keys = ON), so children must go first. Returns the R2 keys of the
 * deleted ICS files so the route handler can also delete those objects —
 * this service stays R2-agnostic like the rest of this file (no env here).
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

// ── Admin: annual bulk resend (§4.12 "Trigger annual bulk resend") ───────

export interface ResendRecipient {
  userId: string;
  email: string;
  name: string;
  hasPreference: boolean;
  icsAttachments: QueuedIcsFileAttachment[];
}

export interface ResendPlan {
  seriesName: string;
  recipients: ResendRecipient[];
}

function icsFilename(seriesName: string, label: string, year: number): string {
  return `${slugify(seriesName)}-${slugify(label)}-${year}.ics`;
}

/**
 * Resolves the smart-routed recipient list for a series' annual resend.
 * Does not queue any emails itself — same DB-only/route-owns-email split
 * every other service in this codebase uses (see membership-onboarding.ts's
 * header note); the caller loops the returned recipients and calls
 * queueEmail/processOutboxByIdBackground per PRD §4.12's per-member ICS
 * attachment routing.
 */
export async function planAnnualResend(
  db: DatabaseLike,
  seriesId: string,
  expected: { scopeType: MeetingSeriesScopeType; workingGroupId?: string },
): Promise<ResendPlan> {
  const series = await getSeriesForAdminOrThrow(db, seriesId, expected);
  const activeFiles = await all<IcsFileRow>(
    db,
    `SELECT * FROM meeting_ics_files WHERE series_id = ? AND active = 1 ORDER BY year DESC, label ASC`,
    [seriesId],
  );
  const allVariantAttachments = activeFiles.map((f) =>
    buildIcsFileAttachment({ r2Key: f.r2_key, filename: icsFilename(series.name, f.label, f.year) }),
  );
  const activeFileIds = new Set(activeFiles.map((f) => f.id));

  interface RecipientRow {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
  }

  const recipientRows =
    series.scope_type === "consortium"
      ? await all<RecipientRow>(
          db,
          `SELECT u.id, u.email, u.first_name, u.last_name
           FROM users u JOIN members m ON m.user_id = u.id AND m.status = 'active'
           WHERE u.active = 1`,
        )
      : await all<RecipientRow>(
          db,
          `SELECT u.id, u.email, u.first_name, u.last_name
           FROM working_group_members wgm
           JOIN users u ON u.id = wgm.user_id
           WHERE wgm.working_group_id = ? AND wgm.left_at IS NULL AND u.active = 1`,
          [series.working_group_id],
        );

  const prefRows = await all<PreferenceRow>(db, `SELECT * FROM member_meeting_preferences WHERE series_id = ?`, [
    seriesId,
  ]);
  const prefByUserId = new Map(prefRows.map((p) => [p.user_id, p]));
  const fileById = new Map(activeFiles.map((f) => [f.id, f]));

  const recipients: ResendRecipient[] = recipientRows.map((row) => {
    const pref = prefByUserId.get(row.id);
    const preferredFile =
      pref?.ics_file_id && activeFileIds.has(pref.ics_file_id) ? fileById.get(pref.ics_file_id) : null;
    const hasPreference = Boolean(preferredFile);
    const icsAttachments = preferredFile
      ? [
          buildIcsFileAttachment({
            r2Key: preferredFile.r2_key,
            filename: icsFilename(series.name, preferredFile.label, preferredFile.year),
          }),
        ]
      : allVariantAttachments;

    return {
      userId: row.id,
      email: row.email,
      name: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
      hasPreference,
      icsAttachments,
    };
  });

  return { seriesName: series.name, recipients };
}

// ── Public: WG meetings (no auth) ─────────────────────────────────────────

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
    `SELECT * FROM meeting_series WHERE scope_type = 'working_group' AND working_group_id = ? AND active = 1 ORDER BY created_at ASC`,
    [wg.id],
  );
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

// ── Member self-service (§4.12 "My Account → Calendar Invites") ──────────

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

// ── Auto-trigger hooks (§4.12 "Post-Approval & WG Join Triggers") ────────

/**
 * All active ICS variants for the consortium series plus the given WG
 * slugs — used to attach calendar invites to the `application-approved-
 * welcome` email (approve.ts, membership-scheduled-jobs.ts's
 * runEcWindowAutoApprove). Returns an empty array when no series/files
 * exist yet (staff hasn't uploaded anything) — never blocks approval.
 */
export async function resolveApprovalIcsAttachments(
  db: DatabaseLike,
  workingGroupSlugs: string[],
): Promise<QueuedIcsFileAttachment[]> {
  const seriesRows = await all<SeriesRow>(
    db,
    `SELECT * FROM meeting_series WHERE active = 1 AND (
       scope_type = 'consortium'
       OR (scope_type = 'working_group' AND working_group_id IN (
         SELECT id FROM working_groups WHERE slug IN (${workingGroupSlugs.map(() => "?").join(", ") || "NULL"})
       ))
     )`,
    workingGroupSlugs,
  );
  if (seriesRows.length === 0) return [];

  const placeholders = seriesRows.map(() => "?").join(", ");
  const icsRows = await all<IcsFileRow>(
    db,
    `SELECT * FROM meeting_ics_files WHERE active = 1 AND series_id IN (${placeholders})`,
    seriesRows.map((s) => s.id),
  );
  const seriesById = new Map(seriesRows.map((s) => [s.id, s]));
  return icsRows.map((f) => {
    const series = seriesById.get(f.series_id);
    return buildIcsFileAttachment({
      r2Key: f.r2_key,
      filename: icsFilename(series?.name ?? "meeting", f.label, f.year),
    });
  });
}

export interface WgJoinCalendarInvite {
  workingGroupName: string;
  attachments: QueuedIcsFileAttachment[];
}

/**
 * All active ICS variants for a WG's active meeting series, resolved by the
 * WG's Google Groups mailing list email — used by
 * runGoogleGroupsSyncPass (membership-scheduled-jobs.ts) to attach
 * calendar invites to `wg-calendar-invite`, queued alongside the existing
 * `mailing-list-enrolled` email for each group a member was just added to.
 * Returns null when the group email doesn't match a working group (e.g.
 * the all-members/consultation lists) or the WG has no active series/files.
 */
export async function resolveWgJoinCalendarInviteByMailingListEmail(
  db: DatabaseLike,
  mailingListEmail: string,
): Promise<WgJoinCalendarInvite | null> {
  const wg = await first<{ id: string; name: string }>(
    db,
    `SELECT id, name FROM working_groups WHERE mailing_list_email = ?`,
    [mailingListEmail],
  );
  if (!wg) return null;

  const series = await first<SeriesRow>(
    db,
    `SELECT * FROM meeting_series WHERE scope_type = 'working_group' AND working_group_id = ? AND active = 1`,
    [wg.id],
  );
  if (!series) return null;

  const icsRows = await all<IcsFileRow>(db, `SELECT * FROM meeting_ics_files WHERE series_id = ? AND active = 1`, [
    series.id,
  ]);
  if (icsRows.length === 0) return null;

  return {
    workingGroupName: wg.name,
    attachments: icsRows.map((f) =>
      buildIcsFileAttachment({ r2Key: f.r2_key, filename: icsFilename(series.name, f.label, f.year) }),
    ),
  };
}
