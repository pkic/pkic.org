/**
 * Paying for a ticket. The person opens a hosted Checkout Session; the signed
 * webhook is the only thing that marks a ticket paid, and it does so in one
 * batch with the payment ledger and the release of the held confirmation.
 */
import type { z } from "zod";
import type { stripeEventEnvelopeSchema } from "../../../../assets/shared/schemas/stripe";
import { formatCurrencyAmount } from "../../../../assets/shared/format-currency";
import { all, first } from "../../db/queries";
import { DIRECT_EMAIL_TEMPLATE_KEY, directEmailBodyPayload } from "../../email/direct-body";
import { prepareQueueEmailStatement } from "../../email/outbox";
import { AppError } from "../../errors";
import { prepareStateGuard, isStateGuardFailure } from "../../db/authorization-guard";
import { createStripeCheckoutSession, expireStripeCheckoutSession } from "../../integrations/stripe/checkout";
import type { DatabaseLike, Env, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareStripePaymentEvent } from "../payments/ledger";
import {
  prepareCompleteRefund,
  prepareFailRefund,
  prepareRefundedTotal,
  prepareReturnUnneededPayment,
} from "./refunds";

type StripeEvent = z.infer<typeof stripeEventEnvelopeSchema>;

const CHECKOUT_LIFETIME_MS = 23 * 3600_000;
const DAY_MS = 86_400_000;

/** A confirmation held for payment sits in the outbox with this delivery time until the ticket is paid. */
export const HELD_UNTIL_PAID = "9999-12-31T00:00:00.000Z";

interface PayableTicketRow {
  send_invoice: number;
  id: string;
  registration_id: string;
  amount: number;
  currency: string;
  status: string;
  ticket_name: string;
  event_id: string;
  event_name: string;
  event_slug: string;
  email: string;
  registration_status: string;
}

interface CheckoutRow {
  id: string;
  request_params: string | null;
  provider_session_id: string | null;
  checkout_url: string | null;
  expires_at: string;
}

/** A ticket with what a payment page or a payment email needs; `columns` adds to the selection. */
const payableTicketSql = (columns = "") => `
  SELECT ticket.id, ticket.registration_id, ticket.amount, ticket.currency, ticket.status,
         type.name AS ticket_name, event.id AS event_id, event.name AS event_name, event.slug AS event_slug,
         user.email, settings.send_invoice, registration.status AS registration_status${columns}
  FROM registration_tickets ticket
  JOIN event_ticket_settings settings ON settings.event_id = ticket.event_id
  JOIN event_ticket_types type ON type.id = ticket.ticket_type_id
  JOIN registrations registration ON registration.id = ticket.registration_id
  JOIN events event ON event.id = ticket.event_id
  JOIN users user ON user.id = registration.user_id`;

/** The short form of a registration's id that people read on an invoice or quote to an organizer. */
export function registrationReference(registrationId: string): string {
  return registrationId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** Where a person finishes or checks their ticket in the portal. */
export function ticketPageUrl(appBaseUrl: string, eventSlug: string): string {
  return `${appBaseUrl}/portal/#/events/${encodeURIComponent(eventSlug)}/ticket`;
}

/**
 * Returns where the person pays. An open session is reused; an expired one is
 * replaced. The attempt row is written before Stripe is called and its id is
 * the idempotency key, so a retry after a failure is the same session.
 */
export async function openTicketCheckout(
  db: DatabaseLike,
  env: Pick<Env, "STRIPE_SECRET_KEY" | "STRIPE_API_BASE">,
  appBaseUrl: string,
  input: { eventId: string; registrationId: string; userId: string },
  fetcher?: typeof fetch,
): Promise<{ checkoutUrl: string }> {
  if (!env.STRIPE_SECRET_KEY)
    throw new AppError(503, "PAYMENT_UNAVAILABLE", "Payment is not available right now. Try again later.");
  const ticket = await first<PayableTicketRow>(
    db,
    `${payableTicketSql()} WHERE ticket.event_id = ? AND ticket.registration_id = ? AND registration.user_id = ?`,
    [input.eventId, input.registrationId, input.userId],
  );
  if (!ticket) throw new AppError(404, "TICKET_NOT_FOUND", "This registration has no ticket.");
  if (ticket.status !== "pending_payment" || ticket.registration_status === "cancelled")
    throw new AppError(409, "TICKET_NOT_PAYABLE", "This ticket has nothing left to pay.");
  const now = nowIso();
  let attempt = await first<CheckoutRow>(
    db,
    `SELECT id, request_params, provider_session_id, checkout_url, expires_at
     FROM registration_ticket_checkouts WHERE ticket_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    [ticket.id],
  );
  // A session opened for another amount or ticket is closed, never offered again: paying it would not settle this ticket.
  if (attempt && attempt.expires_at > now && !checkoutMatchesTicket(attempt, ticket)) {
    // The old session is replaced only once the provider confirms it can no longer be paid.
    // An attempt without a session may be one another request is creating right now. Asking for it again
    // with its own key returns that same session, so it is known and closed before anything replaces it.
    const sessionId =
      attempt.provider_session_id ??
      (
        await createStripeCheckoutSession(env.STRIPE_SECRET_KEY, new URLSearchParams(attempt.request_params ?? ""), {
          idempotencyKey: `registration-ticket:${attempt.id}`,
          fetcher,
          apiBase: env.STRIPE_API_BASE,
        }).catch(() => null)
      )?.id;
    if (
      !sessionId ||
      !(await expireStripeCheckoutSession(env.STRIPE_SECRET_KEY, sessionId, { fetcher, apiBase: env.STRIPE_API_BASE }))
    )
      throw new AppError(503, "PAYMENT_UNAVAILABLE", "Payment is not available right now. Try again later.");
    await db.batch([
      db
        .prepare(
          "UPDATE registration_ticket_checkouts SET expires_at = ?, provider_session_id = COALESCE(provider_session_id, ?) WHERE id = ?",
        )
        .bind(now, sessionId, attempt.id),
    ]);
    attempt = null;
  }
  if (attempt && attempt.expires_at > now && attempt.checkout_url) return { checkoutUrl: attempt.checkout_url };
  if (!attempt || attempt.expires_at <= now) {
    const expiresAt = new Date(Date.parse(now) + CHECKOUT_LIFETIME_MS).toISOString();
    const returnUrl = ticketPageUrl(appBaseUrl, ticket.event_slug);
    const params = new URLSearchParams({
      mode: "payment",
      success_url: returnUrl,
      cancel_url: returnUrl,
      customer_email: ticket.email,
      billing_address_collection: "required",
      // The ticket is settled by an exact amount in the event's currency, so the buyer is not offered another one.
      "adaptive_pricing[enabled]": "false",
      expires_at: String(Math.floor(Date.parse(expiresAt) / 1000)),
      "payment_intent_data[receipt_email]": ticket.email,
      "line_items[0][price_data][currency]": ticket.currency,
      "line_items[0][price_data][unit_amount]": String(ticket.amount),
      "line_items[0][price_data][product_data][name]": checkoutProductName(ticket),
      "line_items[0][quantity]": "1",
      // Both sides name the same registration: Stripe's dashboard and exports carry our reference.
      client_reference_id: ticket.registration_id,
      "payment_intent_data[description]": `${ticket.event_name}: ${ticket.ticket_name} ticket, registration ${registrationReference(ticket.registration_id)}`,
      // A buyer whose employer pays can add their own reference; it shows on the receipt and in Stripe.
      "custom_fields[0][key]": "purchaseorder",
      "custom_fields[0][label][type]": "custom",
      "custom_fields[0][label][custom]": "Purchase order or reference (optional)",
      "custom_fields[0][type]": "text",
      "custom_fields[0][optional]": "true",
    });
    if (ticket.send_invoice === 1) {
      params.set("invoice_creation[enabled]", "true");
      // An invoice needs who it is for: a buyer paying for an organization gives its name and tax ID.
      params.set("tax_id_collection[enabled]", "true");
      params.set("invoice_creation[invoice_data][description]", `${ticket.event_name}: ${ticket.ticket_name} ticket`);
      params.set("invoice_creation[invoice_data][custom_fields][0][name]", "Registration");
      params.set(
        "invoice_creation[invoice_data][custom_fields][0][value]",
        registrationReference(ticket.registration_id),
      );
      params.set("invoice_creation[invoice_data][metadata][registrationId]", ticket.registration_id);
    }
    attempt = {
      id: uuid(),
      request_params: params.toString(),
      provider_session_id: null,
      checkout_url: null,
      expires_at: expiresAt,
    };
    for (const [key, value] of Object.entries({
      pkic_payment_type: "event",
      registrationTicketId: ticket.id,
      registrationId: ticket.registration_id,
      registrationTicketCheckoutId: attempt.id,
      eventId: ticket.event_id,
    })) {
      params.set(`metadata[${key}]`, value);
      params.set(`payment_intent_data[metadata][${key}]`, value);
    }
    attempt.request_params = params.toString();
    await db.batch([
      db
        .prepare(
          `INSERT INTO registration_ticket_checkouts (id, ticket_id, request_params, created_at, expires_at)
           SELECT ?, id, ?, ?, ? FROM registration_tickets WHERE id = ? AND status = 'pending_payment'
             AND NOT EXISTS (SELECT 1 FROM registration_ticket_checkouts open
                             WHERE open.ticket_id = registration_tickets.id AND open.expires_at > ?)`,
        )
        .bind(attempt.id, attempt.request_params, now, expiresAt, ticket.id, now),
    ]);
    // A request that opened its attempt at the same moment won: both continue with that one attempt,
    // so the provider sees one idempotency key and returns one session.
    const open = await first<CheckoutRow>(
      db,
      `SELECT id, request_params, provider_session_id, checkout_url, expires_at
       FROM registration_ticket_checkouts WHERE ticket_id = ? AND expires_at > ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      [ticket.id, now],
    );
    if (!open) throw new AppError(409, "TICKET_NOT_PAYABLE", "This ticket has nothing left to pay.");
    if (open.checkout_url) return { checkoutUrl: open.checkout_url };
    attempt = open;
  }
  const session = await createStripeCheckoutSession(
    env.STRIPE_SECRET_KEY,
    new URLSearchParams(attempt.request_params!),
    {
      idempotencyKey: `registration-ticket:${attempt.id}`,
      fetcher,
      apiBase: env.STRIPE_API_BASE,
    },
  );
  if (!session.url) throw new AppError(502, "STRIPE_ERROR", "The payment provider returned no payment page");
  await db.batch([
    db
      .prepare(
        "UPDATE registration_ticket_checkouts SET provider_session_id = ?, checkout_url = ? WHERE id = ? AND provider_session_id IS NULL",
      )
      .bind(session.id, session.url, attempt.id),
  ]);
  return { checkoutUrl: session.url };
}

function checkoutProductName(ticket: Pick<PayableTicketRow, "event_name" | "ticket_name">): string {
  return `${ticket.event_name}: ${ticket.ticket_name} ticket`;
}

/** Whether a stored checkout attempt asks for what the ticket costs now. */
function checkoutMatchesTicket(attempt: CheckoutRow, ticket: PayableTicketRow): boolean {
  const params = new URLSearchParams(attempt.request_params ?? "");
  return (
    params.get("line_items[0][price_data][unit_amount]") === String(ticket.amount) &&
    params.get("line_items[0][price_data][currency]") === ticket.currency &&
    params.get("line_items[0][price_data][product_data][name]") === checkoutProductName(ticket)
  );
}

interface StripeObjectFields {
  id?: string;
  payment_intent?: string | null;
  amount?: number | null;
  amount_total?: number | null;
  amount_refunded?: number | null;
  status?: string | null;
  failure_reason?: string | null;
  refunded?: boolean;
  currency?: string | null;
  payment_status?: string | null;
  metadata?: Record<string, unknown> | null;
}

function objectFields(event: StripeEvent): StripeObjectFields {
  const value = event.data.object;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as StripeObjectFields) : {};
}

/** Whether a verified Stripe event belongs to a ticket: by its declared purpose, or by a session or intent we stored. */
export async function isEventTicketStripeEvent(db: DatabaseLike, event: StripeEvent): Promise<boolean> {
  const object = objectFields(event);
  if (object.metadata?.pkic_payment_type === "event") return true;
  if (object.metadata?.pkic_payment_type) return false;
  const row = await first<{ found: number }>(
    db,
    `SELECT 1 AS found FROM registration_ticket_checkouts
     WHERE (?1 IS NOT NULL AND provider_session_id = ?1) OR (?2 IS NOT NULL AND payment_intent_id = ?2) LIMIT 1`,
    [object.id?.startsWith("cs_") ? object.id : null, object.payment_intent ?? null],
  );
  return Boolean(row);
}

interface SettlementRow {
  ticket_id: string;
  checkout_id: string;
  amount: number;
  currency: string;
  status: string;
  payment_intent_id: string | null;
  paid_amount: number;
  held_email_id: string | null;
  request_params: string | null;
  recorded: number;
}

/** A provider timestamp in seconds as a UTC instant; null when it is not one. */
const providerInstant = (seconds: unknown): string | null =>
  typeof seconds === "number" && Number.isInteger(seconds) && seconds >= 0
    ? new Date(seconds * 1000).toISOString()
    : null;

/** Stripe's events about one refund, by whichever name the account's API version sends them. */
const REFUND_EVENT_TYPES = ["refund.updated", "refund.failed", "charge.refund.updated"];

/**
 * Applies one verified Stripe event to its ticket. Every effect of an
 * accepted event commits in one batch, keyed by the provider event id, so a
 * redelivery changes nothing.
 */
export async function handleEventTicketStripeEvent(
  db: DatabaseLike,
  event: StripeEvent,
  retried = false,
): Promise<{ received: true; outcome: string }> {
  if (!event.id) return { received: true, outcome: "ignored" };
  const object = objectFields(event);
  const sessionId = object.id?.startsWith("cs_") ? object.id : null;
  const row = await first<SettlementRow>(
    db,
    `SELECT ticket.id AS ticket_id, checkout.id AS checkout_id, ticket.amount, ticket.currency, ticket.status,
            ticket.payment_intent_id, ticket.paid_amount, ticket.held_email_id, checkout.request_params,
            EXISTS (SELECT 1 FROM registration_ticket_payment_events seen WHERE seen.provider_event_id = ?3) AS recorded
     FROM registration_ticket_checkouts checkout JOIN registration_tickets ticket ON ticket.id = checkout.ticket_id
     WHERE (?1 IS NOT NULL AND checkout.provider_session_id = ?1)
        OR (?2 IS NOT NULL AND checkout.payment_intent_id = ?2)
     LIMIT 1`,
    [sessionId, object.payment_intent ?? null, event.id],
  );
  if (!row) return { received: true, outcome: "unknown_ticket" };
  if (row.recorded) return { received: true, outcome: "duplicate" };
  const now = nowIso();
  // When the provider says this happened: refund facts are applied in that order, not in the order they arrive.
  const eventAt = providerInstant((event as StripeEvent & { created?: unknown }).created) ?? now;
  const statements: StatementLike[] = [];
  let outcome = "ignored";
  const paidNow =
    (event.type === "checkout.session.completed" && object.payment_status === "paid") ||
    event.type === "checkout.session.async_payment_succeeded";
  if (paidNow) {
    const matches =
      object.metadata?.registrationTicketId === row.ticket_id &&
      object.amount_total === row.amount &&
      (object.currency ?? "").toLowerCase() === row.currency;
    // A payment is ours when it is what its own payment page asked for, whatever the ticket costs by now.
    const asked = new URLSearchParams(row.request_params ?? "");
    const genuine =
      object.metadata?.registrationTicketId === row.ticket_id &&
      String(object.amount_total) === asked.get("line_items[0][price_data][unit_amount]") &&
      (object.currency ?? "").toLowerCase() === asked.get("line_items[0][price_data][currency]");
    if (!matches && !genuine) outcome = "rejected_mismatch";
    else if (!matches || row.status !== "pending_payment") {
      // Paid on a page for an earlier price, or for a ticket that no longer needs it: the money goes back.
      const settled = matches && row.status === "paid" && object.payment_intent === row.payment_intent_id;
      outcome = settled ? "already_paid" : "returned";
      // Money that arrived for a ticket that no longer needs it keeps its payment reference and goes back.
      statements.push(
        db
          .prepare(
            "UPDATE registration_ticket_checkouts SET payment_intent_id = ? WHERE id = ? AND payment_intent_id IS NULL",
          )
          .bind(object.payment_intent ?? null, row.checkout_id),
      );
      if (!settled && object.payment_intent)
        statements.push(
          prepareReturnUnneededPayment(db, {
            ticketId: row.ticket_id,
            paymentIntentId: object.payment_intent,
            amount: object.amount_total ?? row.amount,
            reason: !matches
              ? "The payment was made on a page for an earlier price"
              : row.status === "paid"
                ? "A second payment arrived for a ticket that was already paid"
                : "The payment arrived after the ticket no longer needed it",
            now,
          }),
        );
    } else {
      outcome = "paid";
      statements.push(
        // The ticket is settled only as it was read: a price or status changed meanwhile is judged again.
        prepareStateGuard(db, {
          sql: "SELECT 1 FROM registration_tickets WHERE id = ? AND status = 'pending_payment' AND amount = ? AND currency = ?",
          bindings: [row.ticket_id, row.amount, row.currency],
        }),
        db
          .prepare(
            `UPDATE registration_tickets SET status = 'paid', paid_at = ?, payment_intent_id = ?, paid_amount = amount,
               refunded_amount = 0,
               refunds_seen_at = NULL, refund_reconcile_at = NULL,
               next_reminder_at = NULL, revision = revision + 1, updated_at = ?
             WHERE id = ? AND status = 'pending_payment'`,
          )
          .bind(now, object.payment_intent ?? null, now, row.ticket_id),
        db
          .prepare(
            "UPDATE registration_ticket_checkouts SET payment_intent_id = ? WHERE id = ? AND payment_intent_id IS NULL",
          )
          .bind(object.payment_intent ?? null, row.checkout_id),
      );
      // The confirmation was queued with the registration and held; paying releases it.
      if (row.held_email_id)
        statements.push(
          db
            .prepare("UPDATE email_outbox SET send_after = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
            .bind(now, now, row.held_email_id),
        );
    }
  } else if (event.type === "charge.refunded") {
    const returned = Math.max(0, object.amount_refunded ?? 0);
    if (!object.payment_intent || object.payment_intent !== row.payment_intent_id) {
      // Another payment than the one that settled the ticket went back: the ticket and its ledger entry stay as they are.
      outcome = "other_payment_refunded";
      if (object.refunded === true && object.payment_intent)
        statements.push(
          db
            .prepare(
              `UPDATE registration_ticket_refunds SET completed_at = ?, last_error = NULL
               WHERE payment_intent_id = ? AND submitted_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL`,
            )
            .bind(now, object.payment_intent),
        );
    } else {
      const full = object.refunded === true || returned >= row.paid_amount;
      outcome = full ? "refunded" : "partially_refunded";
      // The provider's total is what was returned, whoever asked for it and wherever.
      statements.push(
        ...prepareRefundedTotal(
          db,
          { ticketId: row.ticket_id, paymentIntentId: object.payment_intent, refunded: returned, full, at: eventAt },
          now,
        ),
      );
    }
  } else if (REFUND_EVENT_TYPES.includes(event.type) && object.id && object.payment_intent) {
    if (object.status === "succeeded") {
      outcome = "refund_confirmed";
      statements.push(...prepareCompleteRefund(db, { column: "provider_refund_id", value: object.id }, now));
    } else if (object.status === "failed" || object.status === "canceled") {
      outcome = "refund_failed";
      statements.push(
        ...prepareFailRefund(
          db,
          {
            ticketId: row.ticket_id,
            providerRefundId: object.id,
            paymentIntentId: object.payment_intent,
            amount: Math.max(0, object.amount ?? 0),
            reason: `Refund ${object.status} at the payment provider${object.failure_reason ? `: ${object.failure_reason}` : ""}`,
            at: eventAt,
          },
          now,
        ),
      );
    }
  } else if (event.type === "charge.dispute.created") {
    outcome = "handling_required";
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO registration_ticket_payment_events (provider_event_id, ticket_id, event_type, outcome, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(event.id, row.ticket_id, event.type, outcome, now),
    ...(await prepareStripePaymentEvent(
      db,
      "event",
      event,
      ["rejected_mismatch", "partially_refunded", "other_payment_refunded", "returned"].includes(outcome)
        ? outcome
        : null,
    )),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    // A concurrent delivery of the same event won the primary key.
    if (error instanceof Error && /UNIQUE constraint failed: registration_ticket_payment_events/.test(error.message))
      return { received: true, outcome: "duplicate" };
    // The ticket changed between the read and the batch: nothing was written, so the event is judged once more.
    if (isStateGuardFailure(error) && !retried) return handleEventTicketStripeEvent(db, event, true);
    throw error;
  }
  return { received: true, outcome };
}

interface ReminderRow extends PayableTicketRow {
  reminders_sent: number;
  reminders_end_at: string | null;
  reminder_interval_days: number;
}

/** Reminds people with an unpaid ticket, at the event's interval, until its reminder period ends. Nothing is canceled. */
export async function sendTicketPaymentReminders(
  db: DatabaseLike,
  appBaseUrl: string,
  limit = 50,
): Promise<{ reminded: number }> {
  const now = nowIso();
  const due = await all<ReminderRow>(
    db,
    `${payableTicketSql(", ticket.reminders_sent, ticket.reminders_end_at, settings.reminder_interval_days")}
     WHERE ticket.status = 'pending_payment' AND ticket.next_reminder_at IS NOT NULL AND ticket.next_reminder_at <= ?
       AND registration.status NOT IN ('cancelled', 'pending_email_confirmation')
     ORDER BY ticket.next_reminder_at, ticket.id LIMIT ?`,
    [now, limit],
  );
  let reminded = 0;
  for (const ticket of due) {
    const next = new Date(Date.parse(now) + ticket.reminder_interval_days * DAY_MS).toISOString();
    const nextReminder = ticket.reminders_end_at && next <= ticket.reminders_end_at ? next : null;
    const price = formatCurrencyAmount(ticket.amount, ticket.currency);
    try {
      await db.batch([
        // The reminder goes out only if the ticket is still unpaid and nobody else sent this one.
        prepareStateGuard(db, {
          sql: "SELECT 1 FROM registration_tickets WHERE id = ? AND status = 'pending_payment' AND reminders_sent = ?",
          bindings: [ticket.id, ticket.reminders_sent],
        }),
        db
          .prepare(
            `UPDATE registration_tickets SET reminders_sent = reminders_sent + 1, next_reminder_at = ?, updated_at = ?
             WHERE id = ? AND status = 'pending_payment' AND reminders_sent = ?`,
          )
          .bind(nextReminder, now, ticket.id, ticket.reminders_sent),
        prepareTicketPaymentEmail(db, appBaseUrl, ticket, {
          subject: `Reminder: pay for your ${ticket.event_name} ticket`,
          lead: `Your ${ticket.ticket_name} ticket for ${ticket.event_name} is still waiting for payment of ${price}.`,
          idempotencyKey: `ticket-reminder:${ticket.id}:${ticket.reminders_sent + 1}`,
        }),
      ]);
      reminded += 1;
    } catch (error) {
      if (!isStateGuardFailure(error)) throw error;
    }
  }
  return { reminded };
}

/** The email that asks for payment: sent with the registration, and again as a reminder. */
export function prepareTicketPaymentEmail(
  db: DatabaseLike,
  appBaseUrl: string,
  ticket: Pick<PayableTicketRow, "event_id" | "event_slug" | "event_name" | "ticket_name" | "email">,
  message: { subject: string; lead: string; idempotencyKey: string; userId?: string | null },
): StatementLike {
  const url = ticketPageUrl(appBaseUrl, ticket.event_slug);
  return prepareQueueEmailStatement(db, {
    eventId: ticket.event_id,
    baseUrl: appBaseUrl,
    templateKey: DIRECT_EMAIL_TEMPLATE_KEY,
    recipientEmail: ticket.email,
    recipientUserId: message.userId ?? undefined,
    messageType: "transactional",
    subject: message.subject,
    outboxId: uuid(),
    idempotencyKey: message.idempotencyKey,
    data: directEmailBodyPayload(
      `${message.lead}\n\n[Pay for your ticket](${url})\n\nYour registration is confirmed once the payment arrives. To cancel instead, open your registration in the portal.`,
    ),
  }).statement;
}

/**
 * Holds a registration's confirmation email until its ticket is paid and asks
 * for the payment instead. Returns nothing when the ticket has nothing to pay.
 * The statements run after the one that queues the confirmation, in its batch.
 */
export async function prepareHoldConfirmationForPayment(
  db: DatabaseLike,
  appBaseUrl: string,
  input: { registrationId: string; outboxId: string; userId?: string | null },
): Promise<StatementLike[]> {
  const ticket = await first<PayableTicketRow>(
    db,
    `${payableTicketSql()} WHERE ticket.registration_id = ? AND ticket.status = 'pending_payment'`,
    [input.registrationId],
  );
  if (!ticket) return [];
  const now = nowIso();
  return [
    db
      .prepare(
        `UPDATE email_outbox SET send_after = ?, updated_at = ? WHERE id = ? AND status = 'queued'
           AND EXISTS (SELECT 1 FROM registration_tickets WHERE id = ? AND status = 'pending_payment')`,
      )
      .bind(HELD_UNTIL_PAID, now, input.outboxId, ticket.id),
    db
      .prepare("UPDATE registration_tickets SET held_email_id = ? WHERE id = ? AND status = 'pending_payment'")
      .bind(input.outboxId, ticket.id),
    prepareTicketPaymentEmail(db, appBaseUrl, ticket, {
      subject: `Pay for your ${ticket.event_name} ticket`,
      lead: `Thank you for registering for ${ticket.event_name}. Your ${ticket.ticket_name} ticket costs ${formatCurrencyAmount(ticket.amount, ticket.currency)}.`,
      idempotencyKey: `ticket-payment:${ticket.id}:confirmed`,
      userId: input.userId,
    }),
  ];
}
