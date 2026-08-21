/**
 * Auto-trigger hooks ("Post-Approval & WG Join Triggers") that resolve
 * calendar-invite attachments for other services to queue alongside their
 * own emails. Split out of meeting-calendar.ts.
 */
import { all, first } from "../../db/queries";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { icsFilename, type SeriesRow, type IcsFileRow } from "./shared";
import type { DatabaseLike } from "../../types";
import type { QueuedIcsFileAttachment } from "../../email/attachments";
import { buildIcsFileAttachment } from "../../email/attachments";

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
  const workingGroupFilter = buildD1JsonMembershipFilter("slug", workingGroupSlugs);
  const seriesRows = await all<SeriesRow>(
    db,
    `SELECT * FROM meeting_series WHERE active = 1 AND (
       scope_type = 'consortium'
       OR (scope_type = 'working_group' AND working_group_id IN (
         SELECT id FROM working_groups WHERE ${workingGroupFilter.sql}
       ))
     )`,
    workingGroupFilter.bindings,
  );
  if (seriesRows.length === 0) return [];

  const seriesFilter = buildD1JsonMembershipFilter(
    "series_id",
    seriesRows.map((series) => series.id),
  );
  const icsRows = await all<IcsFileRow>(
    db,
    `SELECT * FROM meeting_ics_files WHERE active = 1 AND ${seriesFilter.sql}`,
    seriesFilter.bindings,
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
