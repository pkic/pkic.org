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
import { all, first, run } from "../../db/queries";
import { AppError } from "../../errors";
import { expireStripeCheckoutSession } from "../../integrations/stripe/checkout";
import { createStripeRefund, STRIPE_REFUND_REFUSED } from "../../integrations/stripe/refunds";
import { createDurableJobLease } from "../../jobs/lease";
import type { DatabaseLike, Env, StatementLike, UserBackedAuthAdmin } from "../../types";
import { uuid } from "../../utils/ids";
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
    `SELECT ticket.id, ticket.amount, ticket.refunded_amount, ticket.status,
            EXISTS (SELECT 1 FROM registration_ticket_refunds refund
                    WHERE refund.ticket_id = ticket.id AND ${OPEN_REFUND_SQL}) AS open
     FROM registration_tickets ticket WHERE ticket.event_id = ? AND ticket.registration_id = ?`,
    [input.eventId, input.registrationId],
  );
  if (!ticket) throw new AppError(404, "TICKET_NOT_FOUND", "This registration has no ticket.");
  if (ticket.status !== "paid" || ticket.refunded_amount >= ticket.amount)
    throw new AppError(409, "TICKET_NOT_REFUNDABLE", "Only a paid ticket can be refunded.");
  if (ticket.open) throw new AppError(409, "TICKET_REFUND_PENDING", "A refund for this ticket is already on its way.");
  const now = nowIso();
  const context = { type: "event", id: input.eventId };
  await db.batch([
    preparePermissionsAuthorizationGuard(db, actor, [{ permission: "events:write", context }]),
    // What is asked back is what the provider has not returned yet: part of the payment may already be refunded there.
    db
      .prepare(
        `INSERT INTO registration_ticket_refunds
           (id, ticket_id, payment_intent_id, amount, reason, requested_by_user_id, next_attempt_at, created_at)
         SELECT ?, id, payment_intent_id, amount - refunded_amount, ?, ?, ?, ?
         FROM registration_tickets WHERE id = ? AND status = 'paid' AND amount > refunded_amount
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
  ]);
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
    db
      .prepare(
        `UPDATE registration_tickets SET status = 'refunded', refunded_amount = amount, revision = revision + 1, updated_at = ?
         WHERE status = 'paid' AND EXISTS (${pending})`,
      )
      .bind(now, match.value),
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
 * the amount counts as not returned again, a ticket it had refunded is paid
 * again, and the row is failed so an organizer can ask once more. A refund
 * issued at the provider has no row yet and gets one, which is what makes a
 * second delivery of the failure change nothing.
 */
export function prepareFailRefund(
  db: DatabaseLike,
  input: { ticketId: string; providerRefundId: string; paymentIntentId: string; amount: number; reason: string },
  now: string,
): StatementLike[] {
  return [
    db
      .prepare(
        `UPDATE registration_tickets SET refunded_amount = MAX(0, refunded_amount - ?),
           status = CASE WHEN status = 'refunded' THEN 'paid' ELSE status END,
           revision = revision + 1, updated_at = ?
         WHERE id = ? AND payment_intent_id = ?
           AND NOT EXISTS (SELECT 1 FROM registration_ticket_refunds refund
                           WHERE refund.provider_refund_id = ? AND refund.failed_at IS NOT NULL)`,
      )
      .bind(input.amount, now, input.ticketId, input.paymentIntentId, input.providerRefundId),
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
              amount: 0,
              reason: `Refund ${created.status} at the payment provider`,
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
