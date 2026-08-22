import { all } from "../../db/queries";
import { registrationConfirmPageUrl } from "../frontend-links";
import { buildEventEmailVariables } from "../events";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { queueRegistrationStatusEmail, type RegistrationStatusEmailEvent } from "../registrations/status-notifications";
import {
  confirmationReminderSubject,
  formatPendingConfirmationTimeLeft,
  pendingConfirmationDeadline,
  type ConfirmationReminderRow,
  type EventRouteRow,
  type ReminderCandidatePreview,
} from "../reminders-support";
import { prepareBulkQueueInviteEmailChunkStatements } from "../../email/outbox";
import { batchStatements } from "./shared";
import type { DatabaseLike } from "../../types";
import { queuedCapabilityToken } from "../capability-links";
import { REGISTRATION_RECIPIENT_EMAIL_SQL } from "../registrations/recipient-email";

export async function runConfirmationReminders(
  db: DatabaseLike,
  params: {
    appBaseUrl: string;
    limit: number;
    maxPendingConfirmationReminders: number;
    pendingConfirmationIntervalDays: number;
    pendingConfirmationFallbackDeadlineDays: number;
    confirmationLinkTtlHours: number;
    confirmationCutoff: string;
    now: string;
    dryRun?: boolean;
  },
): Promise<{
  confirmationRemindersQueued: number;
  confirmationCancellationsProcessed: number;
  registrationConfirmations: ReminderCandidatePreview[];
}> {
  const {
    appBaseUrl,
    limit,
    maxPendingConfirmationReminders,
    pendingConfirmationIntervalDays,
    pendingConfirmationFallbackDeadlineDays,
    confirmationLinkTtlHours,
    confirmationCutoff,
    now,
    dryRun,
  } = params;

  const expiredConfirmations =
    limit > 0
      ? await all<ConfirmationReminderRow>(
          db,
          `SELECT
           r.id, r.event_id, u.id AS user_id, u.first_name, u.last_name,
           ${REGISTRATION_RECIPIENT_EMAIL_SQL} AS email,
           r.confirmation_link_secret,
           r.confirmation_reminder_sent_at, r.pending_confirmation_deadline_at, r.created_at,
           e.name AS event_name, e.slug AS event_slug, e.base_path AS event_base_path,
           e.timezone AS event_timezone, e.starts_at AS event_starts_at,
           e.ends_at AS event_ends_at, e.settings_json AS event_settings_json,
           ? AS reminder_count
         FROM registrations r
         JOIN events e ON e.id = r.event_id
         JOIN users u ON u.id = r.user_id
         WHERE r.status = 'pending_email_confirmation'
           AND r.confirmation_reminder_sent_at IS NOT NULL
           AND datetime(r.confirmation_reminder_sent_at) <= datetime(?)
           AND julianday(
             CASE WHEN r.pending_confirmation_deadline_at IS NOT NULL
               THEN r.pending_confirmation_deadline_at
               ELSE datetime(r.created_at, '+' || ? || ' days')
             END
           ) <= julianday(?)
         ORDER BY datetime(r.confirmation_reminder_sent_at) ASC
         LIMIT ?`,
          [maxPendingConfirmationReminders, confirmationCutoff, pendingConfirmationFallbackDeadlineDays, now, limit],
        )
      : [];

  const confirmationCancellationsProcessed = expiredConfirmations.length;

  if (!dryRun && expiredConfirmations.length > 0) {
    const nowValue = nowIso();
    await batchStatements(
      db,
      expiredConfirmations.flatMap((row) => [
        db
          .prepare(
            `UPDATE registrations
             SET status = 'cancelled', cancelled_at = ?,
                 confirmation_link_secret = NULL,
                 pending_confirmation_deadline_at = NULL, confirmation_reminder_sent_at = NULL,
                 updated_at = ?
             WHERE id = ?`,
          )
          .bind(nowValue, nowValue, row.id),
        prepareAuditLog(db, "system", null, "cancelled_pending_confirmation_timeout", "registration", row.id, {
          reminderCount: row.reminder_count,
          maxReminders: maxPendingConfirmationReminders,
          reminderIntervalDays: pendingConfirmationIntervalDays,
          reason: "pending_email_confirmation_timeout",
        }),
        db
          .prepare(
            `UPDATE users
                SET pending_email = NULL, pending_email_expires_at = NULL,
                    pending_email_change_registration_id = NULL, updated_at = ?
              WHERE id = ? AND pending_email_change_registration_id = ?`,
          )
          .bind(nowValue, row.user_id, row.id),
      ]),
    );

    for (const row of expiredConfirmations) {
      const event: RegistrationStatusEmailEvent = {
        id: row.event_id,
        name: row.event_name,
        slug: row.event_slug,
        base_path: row.event_base_path,
        timezone: row.event_timezone,
        starts_at: row.event_starts_at,
        ends_at: row.event_ends_at,
        settings_json: row.event_settings_json,
      };
      await queueRegistrationStatusEmail(db, {
        event,
        registrationId: row.id,
        appBaseUrl,
        templateKey: "registration_updated",
        subject: `Registration cancelled due to missing email confirmation — ${event.name}`,
        // The pending address is selected only for the registration that owns
        // the email-change request; unrelated registrations keep the primary.
        recipientEmailOverride: row.email,
      });
    }
  }

  const remainingReminderBudget = Math.max(0, limit - confirmationCancellationsProcessed);
  const dueConfirmations =
    remainingReminderBudget > 0
      ? await all<ConfirmationReminderRow>(
          db,
          `SELECT
           r.id, r.event_id, u.id AS user_id, u.first_name, u.last_name,
           ${REGISTRATION_RECIPIENT_EMAIL_SQL} AS email,
           r.confirmation_link_secret,
           r.confirmation_reminder_sent_at, r.pending_confirmation_deadline_at, r.created_at,
           e.name AS event_name, e.slug AS event_slug, e.base_path AS event_base_path,
           e.timezone AS event_timezone, e.ends_at AS event_ends_at,
           e.starts_at AS event_starts_at, e.settings_json AS event_settings_json,
           MAX(0, MIN(?, CAST(((julianday(?) - julianday(r.created_at)) / ?) AS INTEGER) - 1)) AS reminder_count
         FROM registrations r
         JOIN events e ON e.id = r.event_id
         JOIN users u ON u.id = r.user_id
         WHERE r.status = 'pending_email_confirmation'
           AND r.confirmation_link_secret IS NOT NULL
           AND datetime(COALESCE(r.confirmation_reminder_sent_at, r.created_at)) <= datetime(?)
           AND julianday(
             CASE WHEN r.pending_confirmation_deadline_at IS NOT NULL
               THEN r.pending_confirmation_deadline_at
               ELSE datetime(r.created_at, '+' || ? || ' days')
             END
           ) > julianday(?)
         ORDER BY datetime(COALESCE(r.confirmation_reminder_sent_at, r.created_at)) ASC
         LIMIT ?`,
          [
            Math.max(0, maxPendingConfirmationReminders - 1),
            now,
            pendingConfirmationIntervalDays,
            confirmationCutoff,
            pendingConfirmationFallbackDeadlineDays,
            now,
            remainingReminderBudget,
          ],
        )
      : [];

  const registrationConfirmations: ReminderCandidatePreview[] = [];
  for (const row of dueConfirmations) {
    const event: EventRouteRow = {
      id: row.event_id,
      name: row.event_name,
      slug: row.event_slug,
      base_path: row.event_base_path,
      starts_at: row.event_starts_at,
      settings_json: row.event_settings_json,
    };
    const deadlineAt = pendingConfirmationDeadline(row);
    const reminderNumber = Number(row.reminder_count ?? 0) + 1;
    registrationConfirmations.push({
      category: "registration_confirmation",
      templateKey: "registration_confirmation_reminder",
      eventName: event.name,
      eventSlug: event.slug,
      recipientEmail: row.email,
      recipientName: [row.first_name, row.last_name].filter(Boolean).join(" ") || null,
      proposalTitle: null,
      reminderNumber,
      dueAt: deadlineAt,
      subject: confirmationReminderSubject(
        event.name,
        deadlineAt,
        new Date(now).getTime(),
        reminderNumber >= maxPendingConfirmationReminders,
      ),
    });
  }

  if (!dryRun && dueConfirmations.length > 0) {
    const reminderRows = dueConfirmations.map((row) => ({
      row,
      confirmationUrl: registrationConfirmPageUrl(
        appBaseUrl,
        {
          slug: row.event_slug,
          base_path: row.event_base_path,
          starts_at: row.event_starts_at,
          settings_json: row.event_settings_json,
        },
        queuedCapabilityToken("registration_confirm", row.id, confirmationLinkTtlHours * 60 * 60),
        row.id,
      ),
    }));

    const emailRows = reminderRows.map(({ row, confirmationUrl }) => {
      const event: EventRouteRow = {
        id: row.event_id,
        name: row.event_name,
        slug: row.event_slug,
        base_path: row.event_base_path,
        starts_at: row.event_starts_at,
        settings_json: row.event_settings_json,
      };
      const deadlineAt = pendingConfirmationDeadline(row);
      const reminderNumber = Number(row.reminder_count ?? 0) + 1;
      const subject = confirmationReminderSubject(
        event.name,
        deadlineAt,
        Date.now(),
        reminderNumber >= maxPendingConfirmationReminders,
      );
      return {
        eventId: event.id,
        recipientEmail: row.email,
        recipientUserId: row.user_id,
        templateKey: "registration_confirmation_reminder",
        subject,
        capabilityLinkValues: [confirmationUrl],
        data: {
          ...buildEventEmailVariables(event, appBaseUrl),
          firstName: row.first_name ?? "",
          confirmationUrl,
          manageUrl: `${appBaseUrl}/events/${event.slug}/manage`,
          timeToExpire: formatPendingConfirmationTimeLeft(deadlineAt),
          reminderCount: String(reminderNumber),
          maxReminders: String(maxPendingConfirmationReminders),
          __subjectOverride: subject,
        },
      };
    });

    const registrationUpdateStatements = reminderRows.flatMap(({ row }) => {
      const deadline = pendingConfirmationDeadline(row);
      return [
        db.prepare(`UPDATE registrations SET confirmation_reminder_sent_at = ? WHERE id = ?`).bind(now, row.id),
        // Extend only the request owned by this registration.
        db
          .prepare(
            `UPDATE users SET pending_email_expires_at = ?, updated_at = ?
              WHERE id = ? AND pending_email_change_registration_id = ?
                AND (pending_email_expires_at IS NULL OR pending_email_expires_at < ?)`,
          )
          .bind(deadline, now, row.user_id, row.id, deadline),
      ];
    });

    await batchStatements(db, [
      ...prepareBulkQueueInviteEmailChunkStatements(db, emailRows, now).map((chunk) => chunk.statement),
      ...registrationUpdateStatements,
    ]);
  }

  return {
    confirmationRemindersQueued: dueConfirmations.length,
    confirmationCancellationsProcessed,
    registrationConfirmations,
  };
}
