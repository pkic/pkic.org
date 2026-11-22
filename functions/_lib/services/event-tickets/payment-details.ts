/**
 * What the payment provider says about a settled ticket's payment: how it was
 * paid, what arrived after the provider's own costs, and its receipt. The
 * signed event settles the ticket; these facts are supplemental, read after
 * it and filled in once, as they are for donations.
 */
import { all } from "../../db/queries";
import { fetchStripePaymentDetails } from "../../integrations/stripe/payment-details";
import type { DatabaseLike, Env } from "../../types";
import { nowIso } from "../../utils/time";

/** A payment older than this is no longer asked about on the scheduled run; an organizer's request still reads it. */
const SCHEDULED_READ_DAYS = 14;

/** A ticket whose payment the provider has not been read for yet. */
export const TICKET_PAYMENT_UNREAD_SQL =
  "ticket.payment_intent_id IS NOT NULL AND (ticket.net_amount IS NULL OR ticket.payment_method IS NULL)";

export async function readTicketPaymentDetails(
  db: DatabaseLike,
  env: Pick<Env, "STRIPE_SECRET_KEY">,
  scope: { ticketId?: string; eventId?: string; limit?: number },
  fetcher?: typeof fetch,
): Promise<{ read: number; failed: number }> {
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) return { read: 0, failed: 0 };
  const requested = Boolean(scope.ticketId ?? scope.eventId);
  const due = await all<{ id: string; payment_intent_id: string }>(
    db,
    `SELECT ticket.id, ticket.payment_intent_id FROM registration_tickets ticket
     WHERE ${TICKET_PAYMENT_UNREAD_SQL}
       AND (?1 IS NULL OR ticket.id = ?1) AND (?2 IS NULL OR ticket.event_id = ?2)
       AND (?3 = 1 OR ticket.paid_at >= ?4)
     ORDER BY ticket.paid_at DESC, ticket.id LIMIT ?5`,
    [
      scope.ticketId ?? null,
      scope.eventId ?? null,
      requested ? 1 : 0,
      new Date(Date.now() - SCHEDULED_READ_DAYS * 86_400_000).toISOString(),
      scope.limit ?? 5,
    ],
  );
  let read = 0;
  let failed = 0;
  for (const ticket of due) {
    const result = await fetchStripePaymentDetails(secretKey, ticket.payment_intent_id, fetcher);
    if (!result.ok) {
      failed += 1;
      continue;
    }
    const details = result.value;
    // Only what is still unknown is filled in, and only for the payment that was asked about.
    await db
      .prepare(
        `UPDATE registration_tickets
         SET payment_method = COALESCE(payment_method, ?), net_amount = COALESCE(net_amount, ?),
             settled_amount = COALESCE(settled_amount, ?), settled_currency = COALESCE(settled_currency, ?),
             receipt_url = COALESCE(receipt_url, ?), updated_at = ?
         WHERE id = ? AND payment_intent_id = ?`,
      )
      .bind(
        details.paymentMethodType,
        details.netAmount,
        details.settledAmount,
        details.settledCurrency?.toLowerCase() ?? null,
        details.receiptUrl ?? null,
        nowIso(),
        ticket.id,
        ticket.payment_intent_id,
      )
      .run();
    read += 1;
  }
  return { read, failed };
}
