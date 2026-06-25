import { all } from "../../db/queries";
import { registrationConfirmPageUrl } from "../frontend-links";
import { buildEventEmailVariables } from "../events";
import { randomToken, sha256Hex } from "../../utils/crypto";
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
import { prepareBulkQueueInviteEmailStatements } from "../../email/outbox";
import { batchStatements } from "./shared";
import type { DatabaseLike } from "../../types";

export async function runConfirmationReminders(
  db: DatabaseLike,
  params: {
    appBaseUrl: string;
    limit: number;
    maxPendingConfirmationReminders: number;
    pendingConfirmationIntervalDays: number;
    pendingConfirmationFallbackDeadlineDays: number;
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
           COALESCE(u.pending_email, u.email) AS email,
           r.confirmation_token_hash, r.confirmation_token_expires_at,
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
                 confirmation_token_hash = NULL, confirmation_token_expires_at = NULL,
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
        // Clear pending_email if no other pending-confirmation registration exists (registration above is already cancelled in this batch).
        db
          .prepare(
            `UPDATE users SET pending_email = NULL, pending_email_expires_at = NULL, updated_at = ?
             WHERE id = ? AND pending_email IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM registrations WHERE user_id = ? AND status = 'pending_email_confirmation')`,
          )
          .bind(nowValue, row.user_id, row.user_id),
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
        // row.email is COALESCE(pending_email, email) — the original bounces.
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
           COALESCE(u.pending_email, u.email) AS email,
           r.confirmation_token_hash, r.confirmation_token_expires_at,
           r.confirmation_reminder_sent_at, r.pending_confirmation_deadline_at, r.created_at,
           e.name AS event_name, e.slug AS event_slug, e.base_path AS event_base_path,
           e.timezone AS event_timezone, e.ends_at AS event_ends_at,
           e.starts_at AS event_starts_at, e.settings_json AS event_settings_json,
           MAX(0, MIN(?, CAST(((julianday(?) - julianday(r.created_at)) / ?) AS INTEGER) - 1)) AS reminder_count
         FROM registrations r
         JOIN events e ON e.id = r.event_id
         JOIN users u ON u.id = r.user_id
         WHERE r.status = 'pending_email_confirmation'
           AND r.confirmation_token_hash IS NOT NULL
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
        Date.now(),
        reminderNumber >= maxPendingConfirmationReminders,
      ),
    });
  }

  if (!dryRun && dueConfirmations.length > 0) {
    const reminderRows = await Promise.all(
      dueConfirmations.map(async (row) => {
        const freshToken = randomToken(24);
        const freshHash = await sha256Hex(freshToken);
        return {
          row,
          freshHash,
          confirmationUrl: registrationConfirmPageUrl(
            appBaseUrl,
            {
              slug: row.event_slug,
              base_path: row.event_base_path,
              starts_at: row.event_starts_at,
              settings_json: row.event_settings_json,
            },
            freshToken,
            row.id,
          ),
        };
      }),
    );

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

    const registrationUpdateStatements = reminderRows.flatMap(({ row, freshHash }) => {
      const deadline = pendingConfirmationDeadline(row);
      return [
        db
          .prepare(
            `UPDATE registrations SET confirmation_reminder_sent_at = ?, confirmation_token_hash = ?, confirmation_token_expires_at = NULL WHERE id = ?`,
          )
          .bind(now, freshHash, row.id),
        // Extend (never shorten) pending_email_expires_at to the deadline so reminder
        // links stay clickable and a shorter-deadline registration can't clobber a longer one.
        db
          .prepare(
            `UPDATE users SET pending_email_expires_at = ? WHERE id = ? AND pending_email IS NOT NULL AND (pending_email_expires_at IS NULL OR pending_email_expires_at < ?)`,
          )
          .bind(deadline, row.user_id, deadline),
      ];
    });

    await batchStatements(db, [
      ...prepareBulkQueueInviteEmailStatements(db, emailRows, now),
      ...registrationUpdateStatements,
    ]);
  }

  return {
    confirmationRemindersQueued: dueConfirmations.length,
    confirmationCancellationsProcessed,
    registrationConfirmations,
  };
}
