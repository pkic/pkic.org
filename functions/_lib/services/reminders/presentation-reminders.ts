import { all } from "../../db/queries";
import { speakerPresentationPageUrl } from "../frontend-links";
import { buildEventEmailVariables } from "../events";
import { randomToken, sha256Hex } from "../../utils/crypto";
import {
  daysUntil,
  presentationReminderSubject,
  type DuePresentationRow,
  type EventRouteRow,
  type ReminderCandidatePreview,
} from "../reminders-support";
import { batchStatements, batchQueueEmailsAndUpdateState } from "./shared";
import type { DatabaseLike } from "../../types";

export async function runPresentationReminders(
  db: DatabaseLike,
  params: {
    appBaseUrl: string;
    limit: number;
    maxPresentationReminders: number;
    cutoff: string;
    now: string;
    dryRun?: boolean;
  },
): Promise<{
  presentationRemindersQueued: number;
  presentationUploads: ReminderCandidatePreview[];
}> {
  const { appBaseUrl, limit, maxPresentationReminders, cutoff, now, dryRun } = params;

  const duePresentation =
    limit > 0
      ? await all<DuePresentationRow>(
          db,
          `SELECT
         ps.id AS speaker_id, ps.proposal_id, ps.user_id,
         u.email, u.first_name, u.last_name,
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
         AND sp.presentation_uploaded_at IS NULL
         AND (sp.presentation_deadline IS NULL OR sp.presentation_deadline > ?)
         AND ps.presentation_reminder_count < ?
         AND (ps.presentation_reminders_paused_until IS NULL OR ps.presentation_reminders_paused_until <= ?)
         AND COALESCE(ps.presentation_last_communication_at, sp.updated_at, ps.created_at) <= ?
       ORDER BY COALESCE(ps.presentation_last_communication_at, sp.updated_at, ps.created_at) ASC
       LIMIT ?`,
          [now, maxPresentationReminders, now, cutoff, limit],
        )
      : [];

  const presentationUploads: ReminderCandidatePreview[] = [];
  for (const row of duePresentation) {
    const event: EventRouteRow = {
      id: row.event_id,
      name: row.event_name,
      slug: row.event_slug,
      base_path: row.event_base_path,
      starts_at: row.event_starts_at,
      settings_json: row.event_settings_json,
    };
    const daysToDeadline = daysUntil(row.presentation_deadline);
    const reminderNumber = Number(row.reminder_count ?? 0) + 1;
    presentationUploads.push({
      category: "presentation_upload_request",
      templateKey: "presentation_upload_request",
      eventName: event.name,
      eventSlug: event.slug,
      recipientEmail: row.email,
      recipientName: [row.first_name, row.last_name].filter(Boolean).join(" ") || null,
      proposalTitle: row.proposal_title,
      reminderNumber,
      dueAt: row.presentation_deadline,
      subject: presentationReminderSubject(event.name, reminderNumber, daysToDeadline),
    });
  }

  if (!dryRun && duePresentation.length > 0) {
    const tokenData = await Promise.all(
      duePresentation.map(async (row) => {
        const token = randomToken(24);
        const hash = await sha256Hex(token);
        return { proposalId: row.proposal_id, userId: row.user_id, speakerId: row.speaker_id, token, hash };
      }),
    );
    const presTokenKey = (proposalId: string, userId: string) => `${proposalId}:${userId}`;
    const presTokenByKey = new Map(tokenData.map((t) => [presTokenKey(t.proposalId, t.userId), t.token]));

    await batchStatements(
      db,
      tokenData.map((t) =>
        db
          .prepare("UPDATE proposal_speakers SET manage_token_hash = ? WHERE proposal_id = ? AND user_id = ?")
          .bind(t.hash, t.proposalId, t.userId),
      ),
    );

    const emailRows = duePresentation.map((row) => {
      const event: EventRouteRow = {
        id: row.event_id,
        name: row.event_name,
        slug: row.event_slug,
        base_path: row.event_base_path,
        starts_at: row.event_starts_at,
        settings_json: row.event_settings_json,
      };
      const daysToDeadline = daysUntil(row.presentation_deadline);
      const reminderNumber = Number(row.reminder_count ?? 0) + 1;
      const subject = presentationReminderSubject(event.name, reminderNumber, daysToDeadline);
      return {
        eventId: row.event_id,
        recipientEmail: row.email,
        recipientUserId: row.user_id,
        templateKey: "presentation_upload_request",
        subject,
        data: {
          ...buildEventEmailVariables(event, appBaseUrl),
          firstName: row.first_name ?? "",
          proposalTitle: row.proposal_title,
          uploadUrl: speakerPresentationPageUrl(
            appBaseUrl,
            event,
            presTokenByKey.get(presTokenKey(row.proposal_id, row.user_id))!,
          ),
          deadline: row.presentation_deadline ?? "",
          isReminder: true,
          reminderCount: String(reminderNumber),
          daysUntilDeadline: daysToDeadline !== null ? String(daysToDeadline) : "",
          __subjectOverride: subject,
        },
      };
    });

    await batchQueueEmailsAndUpdateState(
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
    );
  }

  return { presentationRemindersQueued: duePresentation.length, presentationUploads };
}
