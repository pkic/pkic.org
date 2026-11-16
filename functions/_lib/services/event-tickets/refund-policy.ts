/**
 * The event's refund policy, set by its organizers: no refunds, or refunds
 * until a number of days before the event starts. Within that period a person
 * who cancels gets a paid ticket back, and one who moves to days that cost
 * less gets the difference. After it, and with no policy, nothing is returned
 * unless an organizer refunds the ticket themselves.
 */
import { first } from "../../db/queries";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";

/** The instant until which refunds are given, as SQL over the settings and the event; NULL when none are. */
export const refundDeadlineSql = (settings: string, event: string) =>
  `CASE WHEN ${settings}.refund_days_before_event IS NULL OR ${event}.starts_at IS NULL THEN NULL
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ', ${event}.starts_at, '-' || ${settings}.refund_days_before_event || ' days') END`;

export async function readRefundDeadline(db: DatabaseLike, eventId: string): Promise<string | null> {
  const row = await first<{ deadline: string | null }>(
    db,
    `SELECT ${refundDeadlineSql("settings", "event")} AS deadline
     FROM events event JOIN event_ticket_settings settings ON settings.event_id = event.id WHERE event.id = ?`,
    [eventId],
  );
  return row?.deadline ?? null;
}

/**
 * A paid ticket's status once `refunded` of its payment has gone back: refunded when nothing of the payment
 * is left and the ticket costs something. A ticket that moved to days that cost nothing got its money back
 * and still stands; so does one that got part of its payment back.
 */
export const statusAfterRefundSql = (refunded: string) =>
  `CASE WHEN status NOT IN ('paid', 'refunded') THEN status
        WHEN amount > 0 AND paid_amount - (${refunded}) <= 0 THEN 'refunded' ELSE 'paid' END`;

/** A ticket that can take a refund now: paid, with money left on it, and no other refund under way. */
const REFUNDABLE_TICKET_SQL = `ticket.status = 'paid' AND ticket.paid_amount > ticket.refunded_amount
  AND ticket.refund_reconcile_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM registration_ticket_refunds refund
                  WHERE refund.ticket_id = ticket.id AND refund.completed_at IS NULL AND refund.failed_at IS NULL)`;

/**
 * Returns what a person paid when they cancel within the refund period. One
 * statement that writes nothing outside the period, for an unpaid ticket, or
 * while another refund is under way, so it can sit in any cancellation.
 */
export function prepareRefundOnCancellation(db: DatabaseLike, registrationId: string, now: string): StatementLike {
  return db
    .prepare(
      `INSERT INTO registration_ticket_refunds
         (id, ticket_id, payment_intent_id, amount, reason, next_attempt_at, created_at)
       SELECT ?, ticket.id, ticket.payment_intent_id, ticket.paid_amount - ticket.refunded_amount,
              'Canceled within the refund period', ?, ?
       FROM registration_tickets ticket
       JOIN event_ticket_settings settings ON settings.event_id = ticket.event_id
       JOIN events event ON event.id = ticket.event_id
       WHERE ticket.registration_id = ? AND ${REFUNDABLE_TICKET_SQL}
         AND ${refundDeadlineSql("settings", "event")} >= ?`,
    )
    .bind(uuid(), now, now, registrationId, now);
}

/**
 * Returns the difference when a paid ticket moves to days that cost less.
 * `net` is what was left of the payment when the change was planned: the
 * refund is written only if that still holds.
 */
export function prepareRefundDifference(
  db: DatabaseLike,
  input: { ticketId: string; net: number; total: number; now: string },
): StatementLike {
  return db
    .prepare(
      `INSERT INTO registration_ticket_refunds
         (id, ticket_id, payment_intent_id, amount, reason, next_attempt_at, created_at)
       SELECT ?, ticket.id, ticket.payment_intent_id, ?, 'Changed to days that cost less', ?, ?
       FROM registration_tickets ticket
       WHERE ticket.id = ? AND ${REFUNDABLE_TICKET_SQL} AND ticket.paid_amount - ticket.refunded_amount = ?`,
    )
    .bind(uuid(), input.net - input.total, input.now, input.now, input.ticketId, input.net);
}
