/**
 * Settling a disputed ticket. A person who holds another ticket than the one
 * decided for their organization said why; an organizer keeps their choice,
 * which then becomes the decision for that organization, or moves them to the
 * decided ticket at today's price.
 */
import { TICKET_PAY_BY_ON_CHANGE_SQL } from "./pay-by";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { isStateGuardFailure, prepareStateGuard } from "../../db/authorization-guard";
import { all, first } from "../../db/queries";
import { workEmailDomain } from "../../email-domains/classification";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { ticketReminderSchedule } from "../../../../assets/shared/event-tickets";
import { priceTicket, readTicketPerson } from "./assignment";
import {
  classifierOptions,
  prepareStoreTicketDecision,
  readStoredTicketDecision,
  ticketCriteriaDigest,
} from "./classifier";
import { prepareTicketPaymentEmail } from "./payment-emails";
import { readRefundPolicy } from "./refund-policy";
import { readEventTicketSnapshot } from "./snapshot";

interface DisputedTicketRow {
  id: string;
  ticket_key: string;
  status: string;
  revision: number;
  dispute_reason: string | null;
  dispute_resolved_at: string | null;
  identity_id: string | null;
  email: string;
  user_id: string;
  event_name: string;
  event_slug: string;
}

export async function reviewDisputedTicket(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  event: { id: string; timezone: string },
  registrationId: string,
  decision: "keep" | "move",
  appBaseUrl: string,
): Promise<void> {
  const row = await first<DisputedTicketRow>(
    db,
    `SELECT ticket.id, type.ticket_key, ticket.status, ticket.revision, ticket.dispute_reason, ticket.dispute_resolved_at,
            user.email, user.id AS user_id, event.name AS event_name, event.slug AS event_slug,
            registration.registration_identity_id AS identity_id
     FROM registration_tickets ticket
     JOIN event_ticket_types type ON type.id = ticket.ticket_type_id
     JOIN registrations registration ON registration.id = ticket.registration_id
     JOIN users user ON user.id = registration.user_id
     JOIN events event ON event.id = ticket.event_id
     WHERE ticket.event_id = ? AND ticket.registration_id = ?`,
    [event.id, registrationId],
  );
  if (!row || !row.dispute_reason || row.dispute_resolved_at)
    throw new AppError(409, "TICKET_NOT_DISPUTED", "This ticket has no open dispute.");
  const snapshot = await readEventTicketSnapshot(db, event);
  const digest = await ticketCriteriaDigest(classifierOptions(snapshot.types));
  // The same person the ticket was offered and priced for: the identity registered as, and its verified address.
  const person = await readTicketPerson(db, {
    userId: row.user_id,
    accountEmail: row.email,
    identityId: row.identity_id,
  });
  const subject = { organizationName: person.organizationName, emailDomain: workEmailDomain(person.email) };
  const now = nowIso();
  const statements: StatementLike[] = [
    preparePermissionsAuthorizationGuard(db, actor, [
      { permission: "events:write", context: { type: "event", id: event.id } },
    ]),
    // The ticket is settled only as it was reviewed: another organizer may have settled it, or the person
    // may have registered again for another ticket; then nothing of this review is written.
    prepareStateGuard(db, {
      sql: `SELECT 1 FROM registration_tickets WHERE id = ? AND revision = ? AND dispute_resolved_at IS NULL${decision === "move" ? " AND status <> 'paid'" : ""}`,
      bindings: [row.id, row.revision],
    }),
    prepareAuditLog(db, "user", actor.id, "registration_ticket_dispute_settled", "registration", registrationId, {
      eventId: event.id,
      decision,
    }),
  ];
  if (decision === "keep") {
    statements.push(
      db
        .prepare(
          "UPDATE registration_tickets SET dispute_resolved_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND dispute_resolved_at IS NULL",
        )
        .bind(now, now, row.id),
      prepareStoreTicketDecision(db, {
        criteriaDigest: digest,
        subject,
        ticketKey: row.ticket_key,
        source: "organizer",
        confidence: null,
        model: null,
        decidedByUserId: actor.id,
      }),
    );
    await settle(db, statements);
    return;
  }
  const decided = await readStoredTicketDecision(db, digest, subject);
  const type = decided && snapshot.types.find((candidate) => candidate.ticket_key === decided.ticketKey);
  if (!type) throw new AppError(409, "TICKET_DECISION_MISSING", "There is no decided ticket to move this person to.");
  if (row.status === "paid")
    throw new AppError(
      409,
      "TICKET_ALREADY_PAID",
      "This ticket is paid. Refund it first, then the person can register again.",
    );
  const dayAttendance = await all<{ dayDate: string; attendanceType: string }>(
    db,
    `SELECT day.day_date AS dayDate, attendance.attendance_type AS attendanceType
     FROM registration_day_attendance attendance JOIN event_days day ON day.id = attendance.event_day_id
     WHERE attendance.registration_id = ?`,
    [registrationId],
  );
  const priced = priceTicket(snapshot, { type, code: null }, person, dayAttendance);
  const settings = snapshot.settings!;
  const status = priced.total > 0 ? "pending_payment" : "free";
  const reminders = ticketReminderSchedule(
    {
      intervalDays: settings.reminder_interval_days,
      periodDays: settings.reminder_period_days,
      holdDays: settings.unpaid_hold_days,
    },
    now,
    status === "pending_payment",
  );
  // A ticket that no longer costs anything has no payment to wait for: its held confirmation goes out.
  if (status === "free")
    statements.push(
      db
        .prepare(
          `UPDATE email_outbox SET send_after = ?, updated_at = ?
           WHERE id = (SELECT held_email_id FROM registration_tickets WHERE id = ?) AND status = 'queued'`,
        )
        .bind(now, now, row.id),
    );
  statements.push(
    db
      .prepare(
        `UPDATE registration_tickets SET ticket_type_id = ?, assignment_source = 'organizer', code_id = NULL, amount = ?, currency = ?,
           status = ?, dispute_resolved_at = ?, reminders_sent = 0, next_reminder_at = ?, reminders_end_at = ?,
           pay_by = ${TICKET_PAY_BY_ON_CHANGE_SQL}, revision = revision + 1, updated_at = ?
         WHERE id = ? AND dispute_resolved_at IS NULL AND status <> 'paid'`,
      )
      .bind(
        type.id,
        priced.total,
        settings.currency,
        status,
        now,
        reminders.nextReminderAt,
        reminders.remindersEndAt,
        reminders.payBy,
        reminders.payBy,
        now,
        row.id,
      ),
  );
  if (status === "pending_payment") {
    const policy = await readRefundPolicy(db, event.id);
    statements.push(
      prepareTicketPaymentEmail(
        db,
        appBaseUrl,
        {
          event_id: event.id,
          event_slug: row.event_slug,
          event_name: row.event_name,
          ticket_name: type.name,
          email: row.email,
          amount: priced.total,
          currency: settings.currency,
          timezone: event.timezone,
          refund_deadline: policy.refundableUntil,
          refund_fee: policy.refundFee,
        },
        {
          templateKey: "ticket_changed_payment_request",
          idempotencyKey: `ticket-moved:${row.id}:${now}`,
          userId: row.user_id,
        },
      ),
    );
  }
  await settle(db, statements);
}

async function settle(db: DatabaseLike, statements: StatementLike[]): Promise<void> {
  try {
    await db.batch(statements);
  } catch (error) {
    if (isStateGuardFailure(error)) throw new AppError(409, "TICKET_NOT_DISPUTED", "This ticket has no open dispute.");
    throw error;
  }
}
