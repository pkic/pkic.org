/**
 * Brings one registration's ticket in line with the payment provider on an
 * organizer's request. The provider's events normally do this; where one did
 * not arrive, the same facts are read from the provider and applied through
 * the same handler, so a read and a later event for the same fact change the
 * ticket once.
 */
import { first, all } from "../../db/queries";
import { AppError } from "../../errors";
import { readStripeCheckoutSession } from "../../integrations/stripe/checkout";
import { readStripeRefund } from "../../integrations/stripe/refunds";
import type { DatabaseLike, Env, UserBackedAuthAdmin } from "../../types";
import { prepareAuditLog } from "../audit";
import { handleEventTicketStripeEvent } from "./payment";
import { OPEN_REFUND_SQL, reconcileTicketRefunds } from "./refunds";
import { readRegistrationTicket } from "./registration-ticket";

/** How many payment pages and refunds of one ticket are read in one request. */
const READ_LIMIT = 5;

/** Refund states at the provider that say how a refund ended. */
const SETTLED_REFUND_STATUSES = ["succeeded", "failed", "canceled"];

export async function syncRegistrationTicketWithProvider(
  db: DatabaseLike,
  env: Pick<Env, "STRIPE_SECRET_KEY" | "STRIPE_API_BASE">,
  actor: UserBackedAuthAdmin,
  input: { eventId: string; registrationId: string },
  fetcher?: typeof fetch,
): Promise<{ changed: boolean }> {
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new AppError(503, "NOT_CONFIGURED", "The payment provider is not configured.");
  const read = () => readRegistrationTicket(db, input);
  const before = await read();
  if (!before) throw new AppError(404, "TICKET_NOT_FOUND", "This registration has no ticket.");
  try {
    await applyProviderState(db, env, secretKey, before.id, fetcher);
  } catch (error) {
    // What was applied before the failed read stays applied; asking again picks up from there.
    if (error instanceof AppError && error.code === "STRIPE_ERROR")
      throw new AppError(502, "STRIPE_ERROR", "The payment provider could not be read. Try again.");
    throw error;
  }
  const changed = JSON.stringify(await read()) !== JSON.stringify(before);
  if (changed)
    await prepareAuditLog(db, "user", actor.id, "registration_ticket_synced", "registration", input.registrationId, {
      eventId: input.eventId,
    }).run();
  return { changed };
}

async function applyProviderState(
  db: DatabaseLike,
  env: Pick<Env, "STRIPE_SECRET_KEY" | "STRIPE_API_BASE">,
  secretKey: string,
  ticketId: string,
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
    if (session.status !== "complete" || session.payment_status !== "paid") continue;
    await handleEventTicketStripeEvent(db, {
      id: `sync:${page.provider_session_id}:paid`,
      type: "checkout.session.completed",
      created: askedAt,
      data: { object: session },
    });
  }

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
