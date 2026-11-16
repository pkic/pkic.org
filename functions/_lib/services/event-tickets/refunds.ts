/**
 * Refunding a paid ticket. An organizer's request is a durable row, one for
 * each payment: a refund sent to Stripe still shows the ticket as paid until
 * Stripe's event arrives, and must not be asked for twice. The row is durable; the
 * scheduled job is the only caller of Stripe and retries under a lease with
 * the row id as idempotency key. Stripe's `charge.refunded` webhook, also sent
 * for a refund issued in its dashboard, is what marks the ticket refunded.
 */
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { all, first, run } from "../../db/queries";
import { AppError } from "../../errors";
import { createStripeRefund } from "../../integrations/stripe/refunds";
import { createDurableJobLease } from "../../jobs/lease";
import type { DatabaseLike, Env, UserBackedAuthAdmin } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";

export async function requestTicketRefund(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  input: { eventId: string; registrationId: string; reason: string },
): Promise<void> {
  const ticket = await first<{ id: string; amount: number; status: string; open: number }>(
    db,
    `SELECT ticket.id, ticket.amount, ticket.status,
            EXISTS (SELECT 1 FROM registration_ticket_refunds refund
                    WHERE refund.ticket_id = ticket.id AND refund.created_at >= ticket.paid_at) AS open
     FROM registration_tickets ticket WHERE ticket.event_id = ? AND ticket.registration_id = ?`,
    [input.eventId, input.registrationId],
  );
  if (!ticket) throw new AppError(404, "TICKET_NOT_FOUND", "This registration has no ticket.");
  if (ticket.status !== "paid") throw new AppError(409, "TICKET_NOT_REFUNDABLE", "Only a paid ticket can be refunded.");
  if (ticket.open) throw new AppError(409, "TICKET_REFUND_PENDING", "A refund for this ticket is already on its way.");
  const now = nowIso();
  const context = { type: "event", id: input.eventId };
  await db.batch([
    preparePermissionsAuthorizationGuard(db, actor, [{ permission: "events:write", context }]),
    db
      .prepare(
        `INSERT INTO registration_ticket_refunds (id, ticket_id, amount, reason, requested_by_user_id, next_attempt_at, created_at)
         SELECT ?, id, amount, ?, ?, ?, ? FROM registration_tickets WHERE id = ? AND status = 'paid'
           AND NOT EXISTS (SELECT 1 FROM registration_ticket_refunds refund
                           WHERE refund.ticket_id = registration_tickets.id
                             AND refund.created_at >= registration_tickets.paid_at)`,
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
        amount: ticket.amount,
      },
    ),
  ]);
}

interface DueRefundRow {
  id: string;
  ticket_id: string;
  amount: number;
  attempts: number;
  payment_intent_id: string | null;
}

/** Sends due refund requests to Stripe. A failure is retried later with the same idempotency key. */
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
    `SELECT refund.id, refund.ticket_id, refund.amount, refund.attempts,
            (SELECT checkout.payment_intent_id FROM registration_ticket_checkouts checkout
             WHERE checkout.ticket_id = refund.ticket_id AND checkout.payment_intent_id IS NOT NULL
             ORDER BY checkout.created_at DESC LIMIT 1) AS payment_intent_id
     FROM registration_ticket_refunds refund
     WHERE refund.completed_at IS NULL AND refund.next_attempt_at <= ?
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
       WHERE id = ? AND completed_at IS NULL AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
      [lease.token, lease.expiresAt, refund.id, lease.claimedAt],
    );
    if (!claimed.changes) continue;
    try {
      if (!refund.payment_intent_id) throw new Error("TICKET_PAYMENT_NOT_RECORDED");
      const created = await createStripeRefund(
        env.STRIPE_SECRET_KEY,
        {
          paymentIntentId: refund.payment_intent_id,
          amount: refund.amount,
          metadata: { registrationTicketId: refund.ticket_id },
        },
        { idempotencyKey: `registration-ticket-refund:${refund.id}`, fetcher, apiBase: env.STRIPE_API_BASE },
      );
      await run(
        db,
        `UPDATE registration_ticket_refunds SET provider_refund_id = ?, completed_at = ?, last_error = NULL,
           lease_token = NULL, lease_expires_at = NULL WHERE id = ? AND lease_token = ?`,
        [created.id, nowIso(), refund.id, lease.token],
      );
      processed += 1;
    } catch (error) {
      failed += 1;
      const delaySeconds = Math.min(3600, 2 ** Math.min(refund.attempts, 8) * 60);
      await run(
        db,
        `UPDATE registration_ticket_refunds SET next_attempt_at = ?, last_error = ?, lease_token = NULL, lease_expires_at = NULL
         WHERE id = ? AND lease_token = ?`,
        [
          new Date(Date.now() + delaySeconds * 1000).toISOString(),
          error instanceof Error ? error.message.slice(0, 200) : "unknown",
          refund.id,
          lease.token,
        ],
      );
    }
  }
  return { processed, failed };
}
