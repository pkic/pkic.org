import { all } from "../../db/queries";
import { buildEventEmailVariables } from "../events";
import { nowIso } from "../../utils/time";
import { isAuditOneChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { queueRegistrationStatusEmail, type RegistrationStatusEmailEvent } from "../registrations/status-notifications";
import { registrationConfirmationUrl } from "../registrations/capability-urls";
import {
  confirmationReminderSubject,
  formatPendingConfirmationTimeLeft,
  pendingConfirmationDeadline,
  type ConfirmationReminderRow,
  type EventRouteRow,
  type ReminderCandidatePreview,
} from "../reminders-support";
import { batchQueueEmailsAndUpdateState } from "./shared";
import type { DatabaseLike } from "../../types";
import { REGISTRATION_RECIPIENT_EMAIL_SQL } from "../registrations/recipient-email";
import {
  isRegistrationTransitionConflict,
  prepareRegistrationTransitionGuard,
} from "../registrations/transition-guard";

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
           r.confirmation_reminder_sent_at, r.pending_confirmation_deadline_at, r.transition_revision, r.created_at,
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

  let confirmationCancellationsProcessed = dryRun ? expiredConfirmations.length : 0;
  const cancelledConfirmations: ConfirmationReminderRow[] = [];

  if (!dryRun && expiredConfirmations.length > 0) {
    const nowValue = nowIso();
    for (const row of expiredConfirmations) {
      try {
        await db.batch([
          prepareRegistrationTransitionGuard(db, row),
          db
            .prepare(
              `UPDATE registrations
               SET status = 'cancelled', cancelled_at = ?,
                   confirmation_link_secret = NULL,
                   pending_confirmation_deadline_at = NULL, confirmation_reminder_sent_at = NULL,
                   updated_at = ?
               WHERE id = ?
                 AND status = 'pending_email_confirmation'
                 AND confirmation_link_secret IS ?
                 AND pending_confirmation_deadline_at IS ?
                 AND confirmation_reminder_sent_at IS ?`,
            )
            .bind(
              nowValue,
              nowValue,
              row.id,
              row.confirmation_link_secret,
              row.pending_confirmation_deadline_at,
              row.confirmation_reminder_sent_at,
            ),
          prepareAuditLogAfterOneChange(
            db,
            "system",
            null,
            "cancelled_pending_confirmation_timeout",
            "registration",
            row.id,
            {
              reminderCount: row.reminder_count,
              maxReminders: maxPendingConfirmationReminders,
              reminderIntervalDays: pendingConfirmationIntervalDays,
              reason: "pending_email_confirmation_timeout",
            },
          ),
          db
            .prepare(
              `UPDATE users
                  SET pending_email = NULL, pending_email_expires_at = NULL,
                      pending_email_change_registration_id = NULL,
                      pending_email_current_confirmed_at = NULL, updated_at = ?
                WHERE id = ? AND pending_email_change_registration_id = ?`,
            )
            .bind(nowValue, row.user_id, row.id),
        ]);
        cancelledConfirmations.push(row);
        confirmationCancellationsProcessed += 1;
      } catch (error) {
        if (!isRegistrationTransitionConflict(error) && !isAuditOneChangeGuardFailure(error)) throw error;
      }
    }

    for (const row of cancelledConfirmations) {
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
           r.confirmation_reminder_sent_at, r.pending_confirmation_deadline_at, r.transition_revision, r.created_at,
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
    const reminderRows = await Promise.all(
      dueConfirmations.map(async (row) => ({
        row,
        confirmationUrl: await registrationConfirmationUrl(
          appBaseUrl,
          {
            slug: row.event_slug,
            base_path: row.event_base_path,
            starts_at: row.event_starts_at,
            settings_json: row.event_settings_json,
          },
          { id: row.id, confirmation_link_secret: row.confirmation_link_secret },
          confirmationLinkTtlHours,
        ),
      })),
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

    const queued = await batchQueueEmailsAndUpdateState(
      db,
      emailRows,
      reminderRows.map(({ row }) => {
        const deadline = pendingConfirmationDeadline(row);
        return [
          prepareRegistrationTransitionGuard(db, row),
          db
            .prepare(
              `UPDATE registrations
                 SET confirmation_reminder_sent_at = ?
               WHERE id = ?
                 AND status = 'pending_email_confirmation'
                 AND confirmation_link_secret = ?
                 AND pending_confirmation_deadline_at IS ?
                 AND confirmation_reminder_sent_at IS ?`,
            )
            .bind(
              now,
              row.id,
              row.confirmation_link_secret,
              row.pending_confirmation_deadline_at,
              row.confirmation_reminder_sent_at,
            ),
          prepareAuditLogAfterOneChange(
            db,
            "system",
            null,
            "registration_confirmation_reminder_queued",
            "registration",
            row.id,
            { reminderCount: Number(row.reminder_count ?? 0) + 1, deadline },
            now,
            null,
            `registration_confirmation_reminder:${row.id}:${row.transition_revision}`,
          ),
          db
            .prepare(
              `UPDATE users SET pending_email_expires_at = ?, updated_at = ?
                WHERE id = ? AND pending_email_change_registration_id = ?
                  AND (pending_email_expires_at IS NULL OR pending_email_expires_at < ?)`,
            )
            .bind(deadline, now, row.user_id, row.id, deadline),
        ];
      }),
      now,
      {
        isExpectedConflict: (error) => isRegistrationTransitionConflict(error) || isAuditOneChangeGuardFailure(error),
      },
    );
    return {
      confirmationRemindersQueued: queued,
      confirmationCancellationsProcessed,
      registrationConfirmations,
    };
  }

  return {
    confirmationRemindersQueued: dryRun ? dueConfirmations.length : 0,
    confirmationCancellationsProcessed,
    registrationConfirmations,
  };
}
