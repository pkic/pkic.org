/**
 * The event's refund policy, set by its organizers: no refunds, or refunds
 * until a number of days before the event starts, with or without a fee
 * kept. A ticket is held to the policy its payment page stated, so a later
 * change applies to tickets paid after it. Within that period a person
 * who cancels gets a paid ticket back, and one who moves to days that cost
 * less gets the difference. After it, and with no policy, nothing is returned
 * unless an organizer refunds the ticket themselves.
 */
import { first } from "../../db/queries";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";

export const CANCELLATION_REFUND_REASON = "Canceled within the refund period";
export const CHEAPER_DAYS_REFUND_REASON = "Changed to days that cost less";

/** The instant until which refunds are given, as SQL over the settings and the event; NULL when none are. */
export const refundDeadlineSql = (settings: string, event: string) =>
  `CASE WHEN ${settings}.refund_days_before_event IS NULL OR ${event}.starts_at IS NULL THEN NULL
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ', ${event}.starts_at, '-' || ${settings}.refund_days_before_event || ' days') END`;

/** The event's policy as a registrant is told it: until when refunds are given, and the fee kept from one. */
export async function readRefundPolicy(
  db: DatabaseLike,
  eventId: string,
): Promise<{ refundableUntil: string | null; refundFee: number; transferable: boolean }> {
  const row = await first<{ deadline: string | null; fee: number; transferable: number }>(
    db,
    `SELECT ${refundDeadlineSql("settings", "event")} AS deadline, settings.refund_fee AS fee,
            settings.tickets_transferable AS transferable
     FROM events event JOIN event_ticket_settings settings ON settings.event_id = event.id WHERE event.id = ?`,
    [eventId],
  );
  return {
    refundableUntil: row?.deadline ?? null,
    refundFee: row?.deadline ? row.fee : 0,
    transferable: row?.transferable === 1,
  };
}

/**
 * A paid ticket's status once `refunded` of its payment has gone back: refunded when nothing of the payment
 * is left but fees kept from its refunds, and the ticket costs something. A ticket that moved to days that
 * cost nothing got its money back and still stands; so does one that got part of its payment back. A ticket
 * under payment review leaves the review only when all of its payment went back.
 */
export const statusAfterRefundSql = (refunded: string) =>
  `CASE WHEN status NOT IN ('paid', 'refunded', 'payment_under_review') THEN status
        WHEN amount > 0 AND paid_amount - (${refunded}) <= kept_fee THEN 'refunded'
        WHEN status = 'payment_under_review' THEN status ELSE 'paid' END`;

/** A ticket under payment review whose payment the provider kept after all: paid, or refunded if all went back. */
export const statusAfterKeptPaymentSql = `CASE WHEN amount > 0 AND paid_amount - refunded_amount <= kept_fee
  THEN 'refunded' ELSE 'paid' END`;

/** A ticket that can take a refund now: paid, with money left on it, and no other refund under way. */
const REFUNDABLE_TICKET_SQL = `ticket.status = 'paid' AND ticket.paid_amount > ticket.refunded_amount
  AND ticket.refund_reconcile_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM registration_ticket_refunds refund
                  WHERE refund.ticket_id = ticket.id AND refund.completed_at IS NULL AND refund.failed_at IS NULL)`;

/** Within the refund period the ticket was paid under, with something left to return once its fee is kept. */
const CANCELLATION_REFUND_SQL = `ticket.registration_id = ? AND ${REFUNDABLE_TICKET_SQL}
  AND ticket.refund_until >= ?
  AND ticket.paid_amount - ticket.refunded_amount - ticket.kept_fee > ticket.refund_fee`;

/**
 * Returns what a person paid, less the fee, when they cancel within the
 * refund period their ticket was paid under. The statements write nothing
 * outside the period, for an unpaid ticket, while another refund is under
 * way, or when the fee is all that is left, so they can sit in any cancellation.
 */
export function prepareRefundOnCancellation(db: DatabaseLike, registrationId: string, now: string): StatementLike[] {
  return [
    db
      .prepare(
        `INSERT INTO registration_ticket_refunds
           (id, ticket_id, payment_intent_id, amount, reason, next_attempt_at, created_at)
         SELECT ?, ticket.id, ticket.payment_intent_id,
                ticket.paid_amount - ticket.refunded_amount - ticket.kept_fee - ticket.refund_fee,
                '${CANCELLATION_REFUND_REASON}', ?, ?
         FROM registration_tickets ticket WHERE ${CANCELLATION_REFUND_SQL}`,
      )
      .bind(uuid(), now, now, registrationId, now),
    // The fee stays with the ticket: once the rest has gone back, the ticket counts as refunded.
    // Written only when the refund above was: by then it is the ticket's one open refund, made in this write.
    db
      .prepare(
        `UPDATE registration_tickets SET kept_fee = kept_fee + refund_fee, revision = revision + 1, updated_at = ?
         WHERE registration_id = ? AND status = 'paid'
           AND EXISTS (SELECT 1 FROM registration_ticket_refunds refund
                       WHERE refund.ticket_id = registration_tickets.id AND refund.created_at = ?
                         AND refund.reason = '${CANCELLATION_REFUND_REASON}'
                         AND refund.completed_at IS NULL AND refund.failed_at IS NULL)`,
      )
      .bind(now, registrationId, now),
  ];
}

/**
 * Returns the difference, less the event's fee, when a paid ticket moves to
 * days that cost less. `net` is what was left of the payment when the change
 * was planned: the refund is written only if that still holds.
 */
export function prepareRefundDifference(
  db: DatabaseLike,
  input: { ticketId: string; net: number; refund: number; fee: number; now: string },
): StatementLike[] {
  return [
    db
      .prepare(
        `INSERT INTO registration_ticket_refunds
           (id, ticket_id, payment_intent_id, amount, reason, next_attempt_at, created_at)
         SELECT ?, ticket.id, ticket.payment_intent_id, ?, '${CHEAPER_DAYS_REFUND_REASON}', ?, ?
         FROM registration_tickets ticket
         WHERE ticket.id = ? AND ${REFUNDABLE_TICKET_SQL} AND ticket.paid_amount - ticket.refunded_amount = ?`,
      )
      .bind(uuid(), input.refund, input.now, input.now, input.ticketId, input.net),
    db
      .prepare("UPDATE registration_tickets SET kept_fee = kept_fee + ? WHERE id = ? AND status = 'paid'")
      .bind(input.fee, input.ticketId),
  ];
}
