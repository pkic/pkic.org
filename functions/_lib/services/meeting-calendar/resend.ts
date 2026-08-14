/**
 * Admin: annual bulk resend recipient planning ("Trigger annual bulk
 * resend"). Split out of meeting-calendar.ts.
 */
import { all } from "../../db/queries";
import {
  icsFilename,
  getSeriesForAdminOrThrow,
  type IcsFileRow,
  type PreferenceRow,
  type MeetingSeriesScopeType,
} from "./shared";
import type { DatabaseLike } from "../../types";
import type { QueuedIcsFileAttachment } from "../../email/attachments";
import { buildIcsFileAttachment } from "../../email/attachments";

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

/**
 * Resolves the smart-routed recipient list for a series' annual resend.
 * Does not queue any emails itself — same DB-only/route-owns-email split
 * every other service in this codebase uses (see membership-onboarding.ts's
 * header note); the caller loops the returned recipients and calls
 * queueEmail/processOutboxByIdBackground per-member ICS
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
