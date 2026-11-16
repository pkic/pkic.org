/**
 * Returning a ticket payment. A refund is a durable row for one payment: an
 * organizer asks for one on a paid ticket, and a payment that arrives for a
 * ticket that no longer needs it gets one by itself. The scheduled job is the
 * only caller of Stripe and retries under a lease with the row id as
 * idempotency key.
 *
 * Sent, confirmed and failed are separate facts. Stripe can accept a refund
 * and fail it later, so a row is open until Stripe confirms or refuses it, and
 * a failed one frees the ticket for another request.
 */
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { isStateGuardFailure, prepareStateGuard } from "../../db/authorization-guard";
import { all, first, run } from "../../db/queries";
import { AppError } from "../../errors";
import { expireStripeCheckoutSession } from "../../integrations/stripe/checkout";
import { createStripeRefund, readStripeRefundedTotal, STRIPE_REFUND_REFUSED } from "../../integrations/stripe/refunds";
import { createDurableJobLease } from "../../jobs/lease";
import type { DatabaseLike, Env, StatementLike, UserBackedAuthAdmin } from "../../types";
import { uuid } from "../../utils/ids";
import { statusAfterRefundSql } from "./refund-policy";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";

/** A refund that is neither confirmed nor failed: nothing else is asked for its ticket meanwhile. */
export const OPEN_REFUND_SQL = "refund.completed_at IS NULL AND refund.failed_at IS NULL";

/** After this many refused or failed sends the refund is marked failed, so a person looks at it. */
const MAX_REFUND_ATTEMPTS = 8;

const REFUND_FAILED_STATUSES = ["failed", "canceled"];

export async function requestTicketRefund(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  input: { eventId: string; registrationId: string; reason: string },
): Promise<void> {
  const ticket = await first<{ id: string; amount: number; refunded_amount: number; status: string; open: number }>(
    db,
    `SELECT ticket.id, ticket.paid_amount AS amount, ticket.refunded_amount, ticket.status,
            (ticket.refund_reconcile_at IS NOT NULL
             OR EXISTS (SELECT 1 FROM registration_ticket_refunds refund
                        WHERE refund.ticket_id = ticket.id AND ${OPEN_REFUND_SQL})) AS open
     FROM registration_tickets ticket WHERE ticket.event_id = ? AND ticket.registration_id = ?`,
    [input.eventId, input.registrationId],
  );
  if (!ticket) throw new AppError(404, "TICKET_NOT_FOUND", "This registration has no ticket.");
  // Asked first: while a refund is open or being checked, the ticket's own state is not final.
  if (ticket.open) throw new AppError(409, "TICKET_REFUND_PENDING", "A refund for this ticket is already on its way.");
  if (ticket.status !== "paid" || ticket.refunded_amount >= ticket.amount)
    throw new AppError(409, "TICKET_NOT_REFUNDABLE", "Only a paid ticket can be refunded.");
  const now = nowIso();
  const context = { type: "event", id: input.eventId };
  const statements = [
    preparePermissionsAuthorizationGuard(db, actor, [{ permission: "events:write", context }]),
    // The refund and its audit entry are written together or not at all: the ticket may have been refunded,
    // or one of its refunds may have failed, since it was read.
    prepareStateGuard(db, {
      sql: `SELECT 1 FROM registration_tickets ticket
            WHERE ticket.id = ? AND ticket.status = 'paid' AND ticket.paid_amount > ticket.refunded_amount
              AND ticket.refund_reconcile_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM registration_ticket_refunds refund
                              WHERE refund.ticket_id = ticket.id AND ${OPEN_REFUND_SQL})`,
      bindings: [ticket.id],
    }),
    // What is asked back is what the provider has not returned yet: part of the payment may already be refunded there.
    db
      .prepare(
        `INSERT INTO registration_ticket_refunds
           (id, ticket_id, payment_intent_id, amount, reason, requested_by_user_id, next_attempt_at, created_at)
         SELECT ?, id, payment_intent_id, paid_amount - refunded_amount, ?, ?, ?, ?
         FROM registration_tickets WHERE id = ? AND status = 'paid' AND paid_amount > refunded_amount
           AND refund_reconcile_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM registration_ticket_refunds refund
                           WHERE refund.ticket_id = registration_tickets.id AND ${OPEN_REFUND_SQL})`,
      )
      .bind(uuid(), input.reason, actor.id, now, now, ticket.id),
    prepareAuditLog(
      db,
      "user",
      actor.id,
      "registration_ticket_refund_requested",
      "registration",
      input.registrationId,
      {
        eventId: input.eventId,
        amount: ticket.amount - ticket.refunded_amount,
      },
    ),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (isStateGuardFailure(error))
      throw new AppError(409, "TICKET_REFUND_PENDING", "This ticket changed. Reload it before refunding.");
    throw error;
  }
}

/**
 * Returns a payment nobody asked for: one that arrived for a ticket that was
 * canceled, or a second payment for a ticket that was already paid. One refund
 * per payment, however often its event is delivered.
 */
export function prepareReturnUnneededPayment(
  db: DatabaseLike,
  input: { ticketId: string; paymentIntentId: string; amount: number; reason: string; now: string },
): StatementLike {
  return db
    .prepare(
      `INSERT INTO registration_ticket_refunds (id, ticket_id, payment_intent_id, amount, reason, next_attempt_at, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM registration_ticket_refunds WHERE payment_intent_id = ?)`,
    )
    .bind(
      uuid(),
      input.ticketId,
      input.paymentIntentId,
      input.amount,
      input.reason,
      input.now,
      input.now,
      input.paymentIntentId,
    );
}

/**
 * What a confirmed refund does: the row is complete, and when it returned the
 * payment that settled its ticket, the ticket is refunded. The row is found by
 * its id or by the provider's.
 */
export function prepareCompleteRefund(
  db: DatabaseLike,
  match: { column: "id" | "provider_refund_id"; value: string },
  now: string,
): StatementLike[] {
  const pending = `SELECT 1 FROM registration_ticket_refunds refund
                   WHERE refund.${match.column} = ? AND ${OPEN_REFUND_SQL}
                     AND refund.ticket_id = registration_tickets.id
                     AND refund.payment_intent_id = registration_tickets.payment_intent_id`;
  return [
    // A refund of part of what is left, such as the difference after a move to cheaper days, leaves the ticket
    // paid. What the payment has returned in all is then read from the provider, not added up here.
    db
      .prepare(
        `UPDATE registration_tickets SET refund_reconcile_at = COALESCE(refund_reconcile_at, ?),
           revision = revision + 1, updated_at = ?
         WHERE status = 'paid' AND EXISTS (${pending} AND refund.amount < registration_tickets.paid_amount - registration_tickets.refunded_amount)`,
      )
      .bind(now, now, match.value),
    db
      .prepare(
        `UPDATE registration_tickets SET status = ${statusAfterRefundSql("paid_amount")}, refunded_amount = paid_amount,
           refunds_seen_at = ?, revision = revision + 1, updated_at = ?
         WHERE status = 'paid' AND refund_reconcile_at IS NULL
           AND EXISTS (${pending} AND refund.amount >= registration_tickets.paid_amount - registration_tickets.refunded_amount)`,
      )
      .bind(now, now, match.value),
    db
      .prepare(
        `UPDATE registration_ticket_refunds AS refund SET completed_at = ?, submitted_at = COALESCE(submitted_at, ?),
           last_error = NULL, lease_token = NULL, lease_expires_at = NULL
         WHERE refund.${match.column} = ? AND ${OPEN_REFUND_SQL}`,
      )
      .bind(now, now, match.value),
  ];
}

/**
 * What a refund the provider failed or canceled does, once for each refund:
 * the row is failed so an organizer can ask once more, and the ticket is
 * marked to have its returned amount read again from the provider. Nothing is
 * worked out here: which refunds a reported total held cannot be told from
 * amounts and whole-second times, and the provider knows. A refund issued at
 * the provider has no row yet and gets one, which is what makes a second
 * delivery of the failure change nothing. `at` is the provider's time of the
 * failure, so an older total that arrives afterwards is not applied over it.
 */
export function prepareFailRefund(
  db: DatabaseLike,
  input: {
    ticketId: string;
    providerRefundId: string;
    paymentIntentId: string;
    amount: number;
    reason: string;
    at: string;
  },
  now: string,
): StatementLike[] {
  return [
    db
      .prepare(
        `UPDATE registration_tickets SET refund_reconcile_at = ?,
           refunds_seen_at = CASE WHEN refunds_seen_at IS NULL OR refunds_seen_at < ? THEN ? ELSE refunds_seen_at END,
           revision = revision + 1, updated_at = ?
         WHERE id = ? AND payment_intent_id = ?
           AND NOT EXISTS (SELECT 1 FROM registration_ticket_refunds refund
                           WHERE refund.provider_refund_id = ? AND refund.failed_at IS NOT NULL)`,
      )
      .bind(now, input.at, input.at, now, input.ticketId, input.paymentIntentId, input.providerRefundId),
    db
      .prepare(
        `INSERT INTO registration_ticket_refunds
           (id, ticket_id, payment_intent_id, amount, reason, provider_refund_id, next_attempt_at, submitted_at,
            failed_at, last_error, created_at)
         VALUES (?, ?, ?, ?, 'Refunded at the payment provider', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider_refund_id) DO UPDATE SET
           failed_at = COALESCE(registration_ticket_refunds.failed_at, excluded.failed_at), completed_at = NULL,
           last_error = excluded.last_error, lease_token = NULL, lease_expires_at = NULL`,
      )
      .bind(
        uuid(),
        input.ticketId,
        input.paymentIntentId,
        Math.max(1, input.amount),
        input.providerRefundId,
        now,
        now,
        now,
        input.reason.slice(0, 200),
        now,
      ),
  ];
}

/**
 * Applies the provider's own total of what a payment has returned. The total
 * is the truth as of `at`, a whole second at the provider, and events arrive
 * in any order:
 * - one older than the newest refund fact applied is left out;
 * - one newer is applied;
 * - one from the same second cannot be placed before or after that fact, so
 *   it is not applied and the provider is asked instead.
 */
export function prepareRefundedTotal(
  db: DatabaseLike,
  input: { ticketId: string; paymentIntentId: string; refunded: number; full: boolean; at: string },
  now: string,
): StatementLike[] {
  const full = input.full ? 1 : 0;
  const returnedSql = "CASE WHEN ? = 1 THEN paid_amount ELSE MIN(paid_amount, ?) END";
  return [
    // Runs first: applying the total below moves the ticket to this very second.
    db
      .prepare(
        `UPDATE registration_tickets SET refund_reconcile_at = COALESCE(refund_reconcile_at, ?),
           revision = revision + 1, updated_at = ?
         WHERE id = ? AND payment_intent_id = ? AND refunds_seen_at = ?`,
      )
      .bind(now, now, input.ticketId, input.paymentIntentId, input.at),
    db
      .prepare(
        `UPDATE registration_tickets SET refunded_amount = ${returnedSql},
           status = CASE WHEN status = 'paid' THEN ${statusAfterRefundSql(returnedSql)} ELSE status END,
           refunds_seen_at = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND payment_intent_id = ? AND (refunds_seen_at IS NULL OR refunds_seen_at < ?)`,
      )
      .bind(full, input.refunded, full, input.refunded, input.at, now, input.ticketId, input.paymentIntentId, input.at),
    // All of the payment went back, so every refund of it that the provider holds is done.
    // Not while the provider is still to be asked: then the total above was not taken on trust.
    db
      .prepare(
        `UPDATE registration_ticket_refunds SET completed_at = COALESCE(completed_at, ?), last_error = NULL
         WHERE ? = 1 AND payment_intent_id = ? AND submitted_at IS NOT NULL AND failed_at IS NULL
           AND EXISTS (SELECT 1 FROM registration_tickets ticket
                       WHERE ticket.id = registration_ticket_refunds.ticket_id AND ticket.id = ?
                         AND ticket.payment_intent_id = registration_ticket_refunds.payment_intent_id
                         AND ticket.refunds_seen_at = ? AND ticket.status = 'refunded'
                         AND ticket.refund_reconcile_at IS NULL)`,
      )
      .bind(now, full, input.paymentIntentId, input.ticketId, input.at),
  ];
}

/**
 * Reads again from the provider what each marked ticket's payment has
 * returned, and makes the ticket say that: the amount, and paid or refunded.
 * A ticket is marked when one of its refunds failed, or when a reported total
 * could not be placed in order.
 *
 * The answer is written only to the ticket as it was before the provider was
 * asked: an event that changed it meanwhile may be newer than the answer, so
 * the ticket stays marked and is read again on the next run. The answer
 * counts as known from the second the question was asked, never later, so an
 * event from after that is still applied when it arrives.
 */
export async function reconcileTicketRefunds(
  db: DatabaseLike,
  env: Pick<Env, "STRIPE_SECRET_KEY" | "STRIPE_API_BASE">,
  limit = 5,
  fetcher?: typeof fetch,
): Promise<{ reconciled: number; failed: number }> {
  if (!env.STRIPE_SECRET_KEY) return { reconciled: 0, failed: 0 };
  const due = await all<{ id: string; payment_intent_id: string; revision: number }>(
    db,
    `SELECT id, payment_intent_id, revision FROM registration_tickets
     WHERE refund_reconcile_at IS NOT NULL AND payment_intent_id IS NOT NULL
     ORDER BY refund_reconcile_at, id LIMIT ?`,
    [limit],
  );
  const returnedSql = "CASE WHEN ? = 1 THEN paid_amount ELSE MIN(paid_amount, ?) END";
  let reconciled = 0;
  let failed = 0;
  for (const ticket of due) {
    // The provider's times are whole seconds; so is this one, to compare like with like.
    const askedAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    try {
      const total = await readStripeRefundedTotal(env.STRIPE_SECRET_KEY, ticket.payment_intent_id, {
        fetcher,
        apiBase: env.STRIPE_API_BASE,
      });
      const now = nowIso();
      const full = total.refunded ? 1 : 0;
      // One batch: the ticket as it was before the provider was asked, or nothing. A write that fails part way
      // leaves the ticket marked, so the next run reads again.
      try {
        await db.batch([
          prepareStateGuard(db, {
            sql: "SELECT 1 FROM registration_tickets WHERE id = ? AND payment_intent_id = ? AND revision = ?",
            bindings: [ticket.id, ticket.payment_intent_id, ticket.revision],
          }),
          db
            .prepare(
              `UPDATE registration_tickets SET refunded_amount = ${returnedSql},
                 status = ${statusAfterRefundSql(returnedSql)},
                 refunds_seen_at = CASE WHEN refunds_seen_at IS NULL OR refunds_seen_at < ? THEN ? ELSE refunds_seen_at END,
                 refund_reconcile_at = NULL, revision = revision + 1, updated_at = ?
               WHERE id = ? AND payment_intent_id = ? AND revision = ?`,
            )
            .bind(
              full,
              total.amountRefunded,
              full,
              total.amountRefunded,
              askedAt,
              askedAt,
              now,
              ticket.id,
              ticket.payment_intent_id,
              ticket.revision,
            ),
          // The provider says all of it went back: its refunds of this payment are done.
          db
            .prepare(
              `UPDATE registration_ticket_refunds SET completed_at = COALESCE(completed_at, ?), last_error = NULL
               WHERE ? = 1 AND ticket_id = ? AND payment_intent_id = ? AND submitted_at IS NOT NULL
                 AND failed_at IS NULL`,
            )
            .bind(now, full, ticket.id, ticket.payment_intent_id),
        ]);
        reconciled += 1;
      } catch (error) {
        // Another run or an event got there first: nothing of this answer was written.
        if (!isStateGuardFailure(error)) throw error;
      }
    } catch {
      failed += 1;
    }
  }
  return { reconciled, failed };
}

interface DueRefundRow {
  id: string;
  ticket_id: string;
  amount: number;
  attempts: number;
  payment_intent_id: string | null;
}

/** Sends due refunds to Stripe. A failure is retried later with the same idempotency key, a refusal is final. */
export async function processTicketRefunds(
  db: DatabaseLike,
  env: Pick<Env, "STRIPE_SECRET_KEY" | "STRIPE_API_BASE">,
  limit = 5,
  fetcher?: typeof fetch,
): Promise<{ processed: number; failed: number }> {
  if (!env.STRIPE_SECRET_KEY) return { processed: 0, failed: 0 };
  const now = nowIso();
  const due = await all<DueRefundRow>(
    db,
    `SELECT refund.id, refund.ticket_id, refund.amount, refund.attempts, refund.payment_intent_id
     FROM registration_ticket_refunds refund
     WHERE refund.submitted_at IS NULL AND refund.failed_at IS NULL AND refund.next_attempt_at <= ?
       AND (refund.lease_expires_at IS NULL OR refund.lease_expires_at <= ?)
     ORDER BY refund.next_attempt_at, refund.id LIMIT ?`,
    [now, now, limit],
  );
  let processed = 0;
  let failed = 0;
  for (const refund of due) {
    const lease = createDurableJobLease();
    const claimed = await run(
      db,
      `UPDATE registration_ticket_refunds SET lease_token = ?, lease_expires_at = ?, attempts = attempts + 1
       WHERE id = ? AND submitted_at IS NULL AND failed_at IS NULL
         AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
      [lease.token, lease.expiresAt, refund.id, lease.claimedAt],
    );
    if (!claimed.changes) continue;
    try {
      if (!refund.payment_intent_id) throw new AppError(409, STRIPE_REFUND_REFUSED, "TICKET_PAYMENT_NOT_RECORDED");
      const created = await createStripeRefund(
        env.STRIPE_SECRET_KEY,
        {
          paymentIntentId: refund.payment_intent_id,
          amount: refund.amount,
          metadata: { registrationTicketId: refund.ticket_id },
        },
        { idempotencyKey: `registration-ticket-refund:${refund.id}`, fetcher, apiBase: env.STRIPE_API_BASE },
      );
      const at = nowIso();
      const submitted = db
        .prepare(
          `UPDATE registration_ticket_refunds SET provider_refund_id = ?, submitted_at = ?, last_error = NULL,
             lease_token = NULL, lease_expires_at = NULL WHERE id = ? AND lease_token = ?`,
        )
        .bind(created.id, at, refund.id, lease.token);
      if (created.status && REFUND_FAILED_STATUSES.includes(created.status)) {
        await db.batch([
          submitted,
          ...prepareFailRefund(
            db,
            {
              ticketId: refund.ticket_id,
              providerRefundId: created.id,
              paymentIntentId: refund.payment_intent_id,
              amount: refund.amount,
              reason: `Refund ${created.status} at the payment provider`,
              at,
            },
            at,
          ),
        ]);
        failed += 1;
        continue;
      }
      // Anything but a confirmed refund stays open until the provider's event says how it ended.
      await db.batch([
        submitted,
        ...(created.status === "succeeded" ? prepareCompleteRefund(db, { column: "id", value: refund.id }, at) : []),
      ]);
      processed += 1;
    } catch (error) {
      failed += 1;
      const final =
        (error instanceof AppError && error.code === STRIPE_REFUND_REFUSED) ||
        refund.attempts + 1 >= MAX_REFUND_ATTEMPTS;
      const delaySeconds = Math.min(3600, 2 ** Math.min(refund.attempts, 8) * 60);
      const at = nowIso();
      await run(
        db,
        `UPDATE registration_ticket_refunds SET next_attempt_at = ?, last_error = ?, failed_at = ?,
           lease_token = NULL, lease_expires_at = NULL
         WHERE id = ? AND lease_token = ?`,
        [
          new Date(Date.now() + delaySeconds * 1000).toISOString(),
          error instanceof Error ? error.message.slice(0, 200) : "unknown",
          final ? at : null,
          refund.id,
          lease.token,
        ],
      );
    }
  }
  return { processed, failed };
}

/**
 * Closes payment pages left open for tickets that can no longer be paid, such
 * as one whose registration was canceled, so nobody pays for them afterwards.
 * A page the provider would not close is tried again on the next run.
 */
export async function closeUnpayableTicketCheckouts(
  db: DatabaseLike,
  env: Pick<Env, "STRIPE_SECRET_KEY" | "STRIPE_API_BASE">,
  limit = 10,
  fetcher?: typeof fetch,
): Promise<{ closed: number }> {
  if (!env.STRIPE_SECRET_KEY) return { closed: 0 };
  const now = nowIso();
  const open = await all<{ id: string; provider_session_id: string }>(
    db,
    `SELECT checkout.id, checkout.provider_session_id
     FROM registration_ticket_checkouts checkout JOIN registration_tickets ticket ON ticket.id = checkout.ticket_id
     WHERE checkout.expires_at > ? AND checkout.provider_session_id IS NOT NULL AND checkout.payment_intent_id IS NULL
       AND ticket.status NOT IN ('pending_payment', 'paid')
     ORDER BY checkout.created_at, checkout.id LIMIT ?`,
    [now, limit],
  );
  let closed = 0;
  for (const checkout of open) {
    const expired = await expireStripeCheckoutSession(env.STRIPE_SECRET_KEY, checkout.provider_session_id, {
      fetcher,
      apiBase: env.STRIPE_API_BASE,
    });
    if (!expired) continue;
    await run(db, "UPDATE registration_ticket_checkouts SET expires_at = ? WHERE id = ? AND expires_at > ?", [
      nowIso(),
      checkout.id,
      now,
    ]);
    closed += 1;
  }
  return { closed };
}
