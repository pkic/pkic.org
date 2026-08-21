/**
 * Admin annual bulk resend planning and durable enqueueing.
 */
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import { prepareBulkQueueEmailChunkStatements } from "../../email/outbox";
import {
  icsFilename,
  ICS_FILE_SELECT_COLUMNS,
  PREFERENCE_SELECT_COLUMNS,
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

export interface AnnualResendResult {
  seriesName: string;
  queuedRecipients: number;
}

/**
 * Resolves the smart-routed recipient list for a series' annual resend.
 * The explicit limit keeps an admin action inside the configured D1/Worker
 * budget and lets the caller fail before enqueueing only part of a send.
 */
async function planAnnualResend(
  db: DatabaseLike,
  seriesId: string,
  expected: { scopeType: MeetingSeriesScopeType; workingGroupId?: string },
  maxRecipients: number,
): Promise<ResendPlan> {
  const series = await getSeriesForAdminOrThrow(db, seriesId, expected);
  const activeFiles = await all<IcsFileRow>(
    db,
    `SELECT ${ICS_FILE_SELECT_COLUMNS} FROM meeting_ics_files
      WHERE series_id = ? AND active = 1 ORDER BY year DESC, label ASC, id ASC`,
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
          `SELECT id, email, first_name, last_name
             FROM (
               SELECT u.id AS id, u.email AS email, u.first_name AS first_name, u.last_name AS last_name
                 FROM members m
                 JOIN users u ON u.id = m.user_id
                WHERE m.status = 'active' AND u.active = 1
               UNION
               SELECT u.id AS id, u.email AS email, u.first_name AS first_name, u.last_name AS last_name
                 FROM members m
                 JOIN organization_representatives representative
                   ON representative.member_id = m.id AND representative.left_at IS NULL
                 JOIN users u ON u.id = representative.user_id
                WHERE m.status = 'active' AND u.active = 1
             )
            ORDER BY id
            LIMIT ?`,
          [maxRecipients + 1],
        )
      : await all<RecipientRow>(
          db,
          `SELECT u.id, u.email, u.first_name, u.last_name
           FROM working_group_members wgm
           JOIN users u ON u.id = wgm.user_id
           WHERE wgm.working_group_id = ? AND wgm.left_at IS NULL AND u.active = 1
           ORDER BY u.id
           LIMIT ?`,
          [series.working_group_id, maxRecipients + 1],
        );

  if (recipientRows.length > maxRecipients) {
    throw new AppError(
      422,
      "RESEND_RECIPIENT_LIMIT_EXCEEDED",
      `Annual resend exceeds the configured ${maxRecipients}-recipient limit`,
    );
  }

  const prefRows = await all<PreferenceRow>(
    db,
    `SELECT ${PREFERENCE_SELECT_COLUMNS} FROM member_meeting_preferences WHERE series_id = ?`,
    [seriesId],
  );
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

/**
 * Owns the complete durable enqueue operation. HTTP adapters only resolve
 * authorization/scope and serialize this result; scheduled outbox processing
 * remains the single delivery/retry owner.
 */
export async function queueAnnualResend(
  db: DatabaseLike,
  seriesId: string,
  expected: { scopeType: MeetingSeriesScopeType; workingGroupId?: string },
  maxRecipients: number,
): Promise<AnnualResendResult> {
  const plan = await planAnnualResend(db, seriesId, expected, maxRecipients);
  const chunks = prepareBulkQueueEmailChunkStatements(
    db,
    plan.recipients.map((recipient) => ({
      templateKey: "calendar-invite-resend",
      recipientEmail: recipient.email,
      recipientUserId: recipient.userId,
      messageType: "transactional",
      subject: `Updated calendar invite: ${plan.seriesName}`,
      data: {
        memberName: recipient.name,
        seriesName: plan.seriesName,
        hasPreference: recipient.hasPreference,
      },
      attachments: recipient.icsAttachments,
    })),
  );
  if (chunks.length > 0) await db.batch(chunks.map((chunk) => chunk.statement));
  return { seriesName: plan.seriesName, queuedRecipients: plan.recipients.length };
}
