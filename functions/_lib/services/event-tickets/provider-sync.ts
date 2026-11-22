/**
 * Brings one registration's ticket in line with the payment provider on
 * request: an organizer's, or the registrant's own when they come back from
 * the payment page before the provider's event has arrived. The provider's
 * events normally do this; where one did not arrive, the same facts are read
 * from the provider and applied through the same handler, so a read and a
 * later event for the same fact change the ticket once.
 */
import { first, all } from "../../db/queries";
import { AppError } from "../../errors";
import { readStripeCheckoutSession } from "../../integrations/stripe/checkout";
import { readStripeRefund } from "../../integrations/stripe/refunds";
import type { DatabaseLike, Env } from "../../types";
import { prepareAuditLog } from "../audit";
import { handleEventTicketStripeEvent } from "./payment";
import { readTicketPaymentDetails } from "./payment-details";
import { OPEN_REFUND_SQL, reconcileTicketRefunds } from "./refunds";
import { readRegistrationTicket } from "./registration-ticket";

/** How many payment pages and refunds of one ticket are read in one request. */
const READ_LIMIT = 5;

/** Refund states at the provider that say how a refund ended. */
const SETTLED_REFUND_STATUSES = ["succeeded", "failed", "canceled"];

export async function syncRegistrationTicketWithProvider(
  db: DatabaseLike,
  env: Pick<Env, "STRIPE_SECRET_KEY" | "STRIPE_API_BASE">,
  actor: { id: string },
  /** `paymentOnly` is the registrant's own check: whether their payment arrived, and nothing about refunds. */
  input: { eventId: string; registrationId: string; paymentOnly?: boolean },
  fetcher?: typeof fetch,
): Promise<{ changed: boolean; outboxIds: string[] }> {
  const secretKey = env.STRIPE_SECRET_KEY;
  // Without a provider the registrant's own check has nothing to learn; an organizer is told why.
  if (!secretKey && input.paymentOnly) return { changed: false, outboxIds: [] };
  if (!secretKey) throw new AppError(503, "NOT_CONFIGURED", "The payment provider is not configured.");
  const read = () => readRegistrationTicket(db, input);
  const before = await read();
  if (!before) throw new AppError(404, "TICKET_NOT_FOUND", "This registration has no ticket.");
  // A registrant with nothing to pay has nothing to ask the provider.
  if (input.paymentOnly && before.status !== "pending_payment") return { changed: false, outboxIds: [] };
  // Emails that a settled payment released; the route sends them with its response.
  const outboxIds: string[] = [];
  try {
    await applyProviderState(outboxIds, db, env, secretKey, before.id, Boolean(input.paymentOnly), fetcher);
  } catch (error) {
    // What was applied before the failed read stays applied; asking again picks up from there.
    if (error instanceof AppError && error.code === "STRIPE_ERROR")
      throw new AppError(502, "STRIPE_ERROR", "The payment provider could not be read. Try again.");
    throw error;
  }
  // How the payment was made and what arrived, where that was not read yet; a failed read is tried again later.
  // The registrant waits on this answer, so for them the route reads it after responding.
  if (!input.paymentOnly) await readTicketPaymentDetails(db, env, { ticketId: before.id }, fetcher);
  const changed = JSON.stringify(await read()) !== JSON.stringify(before);
  if (changed)
    await prepareAuditLog(db, "user", actor.id, "registration_ticket_synced", "registration", input.registrationId, {
      eventId: input.eventId,
    }).run();
  return { changed, outboxIds };
}

async function applyProviderState(
  outboxIds: string[],
  db: DatabaseLike,
  env: Pick<Env, "STRIPE_SECRET_KEY" | "STRIPE_API_BASE">,
  secretKey: string,
  ticketId: string,
  paymentOnly: boolean,
  fetcher?: typeof fetch,
): Promise<void> {
  const options = { fetcher, apiBase: env.STRIPE_API_BASE };
  // The provider's times are whole seconds; what is read counts as known from the second it was asked.
  const askedAt = Math.floor(Date.now() / 1000);

  // Payment pages that were opened and are not known to be paid.
  const pages = await all<{ provider_session_id: string }>(
    db,
    `SELECT provider_session_id FROM registration_ticket_checkouts
     WHERE ticket_id = ? AND provider_session_id IS NOT NULL AND payment_intent_id IS NULL
     ORDER BY created_at DESC, id LIMIT ?`,
    [ticketId, READ_LIMIT],
  );
  for (const page of pages) {
    const session = await readStripeCheckoutSession(secretKey, page.provider_session_id, options);
    // A finished page was paid, or its payment is on its way; either is applied as the provider's event would be.
    if (session.status !== "complete" || (session.payment_status !== "paid" && session.payment_status !== "unpaid"))
      continue;
    const applied = await handleEventTicketStripeEvent(db, {
      id: `sync:${page.provider_session_id}:${session.payment_status === "paid" ? "paid" : "processing"}`,
      type: "checkout.session.completed",
      created: askedAt,
      data: { object: session },
    });
    outboxIds.push(...applied.outboxIds);
    // A ticket is paid once; the pages opened before that one have nothing to add.
    if (session.payment_status === "paid") break;
  }

  if (paymentOnly) return;

  // Refunds that were sent and have not been confirmed or failed.
  const refunds = await all<{ provider_refund_id: string }>(
    db,
    `SELECT refund.provider_refund_id FROM registration_ticket_refunds refund
     WHERE refund.ticket_id = ? AND refund.provider_refund_id IS NOT NULL AND ${OPEN_REFUND_SQL}
     ORDER BY refund.created_at, refund.id LIMIT ?`,
    [ticketId, READ_LIMIT],
  );
  for (const refund of refunds) {
    const held = await readStripeRefund(secretKey, refund.provider_refund_id, options);
    if (typeof held.status !== "string" || !SETTLED_REFUND_STATUSES.includes(held.status)) continue;
    await handleEventTicketStripeEvent(db, {
      id: `sync:${refund.provider_refund_id}:${held.status}`,
      type: "refund.updated",
      created: askedAt,
      data: { object: held },
    });
  }

  // What the provider says the ticket's own payment has returned, by whoever and wherever.
  const paid = await first<{ id: string }>(
    db,
    "SELECT id FROM registration_tickets WHERE id = ? AND payment_intent_id IS NOT NULL",
    [ticketId],
  );
  if (paid) {
    const totals = await reconcileTicketRefunds(db, env, 1, fetcher, ticketId);
    if (totals.failed) throw new AppError(502, "STRIPE_ERROR", "Failed to read the payment");
  }
}
