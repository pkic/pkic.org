import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";

/** Current ordered provider standing that cannot safely admit a ticket. */
export const ticketPaymentNeedsReviewSql = (paymentIntent: string) => `EXISTS (
  SELECT 1 FROM payment_ledger_entries ledger
  WHERE ledger.provider = 'stripe' AND ledger.provider_payment_intent_id = ${paymentIntent}
    AND ledger.status IN ('disputed', 'refunded')
)`;

/** Converge a ticket after an adjustment initially lacked its Checkout mapping. */
export async function suspendTicketWithPaymentReview(db: DatabaseLike, paymentIntent: string): Promise<void> {
  await db
    .prepare(
      `UPDATE registration_tickets SET status = 'payment_under_review', revision = revision + 1, updated_at = ?1
     WHERE id = (SELECT ticket_id FROM registration_ticket_checkouts WHERE payment_intent_id = ?2)
       AND payment_intent_id = ?2 AND status = 'paid'
       AND ${ticketPaymentNeedsReviewSql("registration_tickets.payment_intent_id")}`,
    )
    .bind(nowIso(), paymentIntent)
    .run();
}
