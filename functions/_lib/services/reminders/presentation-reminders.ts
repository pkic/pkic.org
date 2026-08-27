import { all } from "../../db/queries";
import { emailPlainText } from "../../email/plain-text";
import { speakerPresentationPageUrl } from "../frontend-links";
import { buildEventEmailVariables } from "../events";
import {
  daysUntil,
  presentationReminderSubject,
  type DuePresentationRow,
  type EventRouteRow,
  type ReminderCandidatePreview,
} from "../reminders-support";
import { batchQueueEmailsAndUpdateState, prepareSpeakerReminderRecipientGuard } from "./shared";
import type { DatabaseLike } from "../../types";
import { proposalSpeakerEffectiveProfileColumns, queuedSpeakerManageToken } from "../proposal-speakers";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";

export async function runPresentationReminders(
  db: DatabaseLike,
  params: {
    appBaseUrl: string;
    limit: number;
    maxPresentationReminders: number;
    windowEnd: string;
    cutoff: string;
    now: string;
    dryRun?: boolean;
  },
): Promise<{
  presentationRemindersQueued: number;
  presentationUploads: ReminderCandidatePreview[];
}> {
  const { appBaseUrl, limit, maxPresentationReminders, windowEnd, cutoff, now, dryRun } = params;

  const duePresentation =
    limit > 0
      ? await all<DuePresentationRow>(
          db,
          `SELECT
         ps.id AS speaker_id, ps.proposal_id, ps.user_id, ps.manage_link_secret,
         u.email, u.normalized_email,
         ${proposalSpeakerEffectiveProfileColumns("u", "ps", "", ["firstName", "lastName"])},
         sp.title AS proposal_title, sp.event_id,
         e.name AS event_name, e.slug AS event_slug,
         e.base_path AS event_base_path, e.starts_at AS event_starts_at,
         e.settings_json AS event_settings_json,
         sp.presentation_deadline, ps.presentation_reminder_count AS reminder_count
       FROM proposal_speakers ps
       JOIN users u ON u.id = ps.user_id
       JOIN session_proposals sp ON sp.id = ps.proposal_id
       JOIN events e ON e.id = sp.event_id
       WHERE sp.status = 'accepted'
         AND ps.status IN ('invited', 'confirmed')
         AND NOT EXISTS (
           SELECT 1
           FROM presentation_versions pv
           WHERE pv.proposal_id = sp.id
             AND pv.is_current = 1
             AND pv.deleted_at IS NULL
         )
         AND COALESCE(sp.presentation_deadline, e.starts_at) > ?
         AND COALESCE(sp.presentation_deadline, e.starts_at) <= ?
         AND ps.presentation_reminder_count < ?
         AND (ps.presentation_reminders_paused_until IS NULL OR ps.presentation_reminders_paused_until <= ?)
         AND COALESCE(ps.presentation_last_communication_at, sp.updated_at, ps.created_at) <= ?
       ORDER BY COALESCE(ps.presentation_last_communication_at, sp.updated_at, ps.created_at) ASC
       LIMIT ?`,
          [now, windowEnd, maxPresentationReminders, now, cutoff, limit],
        )
      : [];

  const preparedRows = duePresentation.map((row) => {
    const event: EventRouteRow = {
      id: row.event_id,
      name: row.event_name,
      slug: row.event_slug,
      base_path: row.event_base_path,
      starts_at: row.event_starts_at,
      settings_json: row.event_settings_json,
    };
    const effectiveDeadline = row.presentation_deadline ?? row.event_starts_at;
    const daysToDeadline = daysUntil(effectiveDeadline);
    const reminderNumber = Number(row.reminder_count ?? 0) + 1;
    const subject = presentationReminderSubject(event.name, reminderNumber, daysToDeadline);
    return { row, event, effectiveDeadline, daysToDeadline, reminderNumber, subject };
  });

  const presentationUploads: ReminderCandidatePreview[] = preparedRows.map(
    ({ row, event, effectiveDeadline, reminderNumber, subject }) => ({
      category: "presentation_upload_request",
      templateKey: "presentation_upload_request",
      eventName: event.name,
      eventSlug: event.slug,
      recipientEmail: row.email,
      recipientName: [row.first_name, row.last_name].filter(Boolean).join(" ") || null,
      proposalTitle: row.proposal_title,
      reminderNumber,
      dueAt: effectiveDeadline,
      subject,
    }),
  );

  if (!dryRun && duePresentation.length > 0) {
    const emailRows = await Promise.all(
      preparedRows.map(async ({ row, event, effectiveDeadline, daysToDeadline, reminderNumber, subject }) => {
        const uploadUrl = speakerPresentationPageUrl(
          appBaseUrl,
          event,
          await queuedSpeakerManageToken(db, row.speaker_id, row.manage_link_secret),
        );
        return {
          eventId: row.event_id,
          recipientEmail: row.email,
          recipientUserId: row.user_id,
          templateKey: "presentation_upload_request",
          subject,
          capabilityLinkValues: [uploadUrl],
          data: {
            ...buildEventEmailVariables(event, appBaseUrl),
            proposalId: row.proposal_id,
            speakerUserId: row.user_id,
            firstName: emailPlainText(row.first_name ?? ""),
            proposalTitle: emailPlainText(row.proposal_title),
            uploadUrl,
            deadline: effectiveDeadline ?? "",
            isReminder: true,
            reminderCount: String(reminderNumber),
            daysUntilDeadline: daysToDeadline !== null ? String(daysToDeadline) : "",
            __subjectOverride: subject,
          },
        };
      }),
    );

    const queuedCount = await batchQueueEmailsAndUpdateState(
      db,
      emailRows,
      duePresentation.map((row) =>
        db
          .prepare(
            `UPDATE proposal_speakers
           SET presentation_reminder_count = presentation_reminder_count + 1,
               presentation_last_communication_at = ?,
               presentation_reminders_paused_until = NULL
           WHERE id = ?`,
          )
          .bind(now, row.speaker_id),
      ),
      now,
      {
        isExpectedConflict: isAuthorizationGuardFailure,
        prepareSliceStatements: (start, end) => [
          prepareSpeakerReminderRecipientGuard(
            db,
            duePresentation.slice(start, end).map((row) => ({
              speakerId: row.speaker_id,
              userId: row.user_id,
              normalizedEmail: row.normalized_email,
            })),
          ),
        ],
      },
    );
    return { presentationRemindersQueued: queuedCount, presentationUploads };
  }

  return { presentationRemindersQueued: duePresentation.length, presentationUploads };
}
