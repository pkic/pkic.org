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
    if (attempt.provider_session_id)
      await expireStripeCheckoutSession(env.STRIPE_SECRET_KEY, attempt.provider_session_id, {
        fetcher,
        apiBase: env.STRIPE_API_BASE,
      });
    await db.batch([
      db.prepare("UPDATE registration_ticket_checkouts SET expires_at = ? WHERE id = ?").bind(now, attempt.id),
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
           SELECT ?, id, ?, ?, ? FROM registration_tickets WHERE id = ? AND status = 'pending_payment'`,
        )
        .bind(attempt.id, attempt.request_params, now, expiresAt, ticket.id),
    ]);
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
  amount_total?: number | null;
  amount_refunded?: number | null;
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
  held_email_id: string | null;
  recorded: number;
}

/**
 * Applies one verified Stripe event to its ticket. Every effect of an
 * accepted event commits in one batch, keyed by the provider event id, so a
 * redelivery changes nothing.
 */
export async function handleEventTicketStripeEvent(
  db: DatabaseLike,
  event: StripeEvent,
): Promise<{ received: true; outcome: string }> {
  if (!event.id) return { received: true, outcome: "ignored" };
  const object = objectFields(event);
  const sessionId = object.id?.startsWith("cs_") ? object.id : null;
  const row = await first<SettlementRow>(
    db,
    `SELECT ticket.id AS ticket_id, checkout.id AS checkout_id, ticket.amount, ticket.currency, ticket.status,
            ticket.held_email_id,
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
    if (!matches) outcome = "rejected_mismatch";
    else if (row.status !== "pending_payment") outcome = row.status === "paid" ? "already_paid" : "handling_required";
    else {
      outcome = "paid";
      statements.push(
        db
          .prepare(
            `UPDATE registration_tickets SET status = 'paid', paid_at = ?, next_reminder_at = NULL,
               revision = revision + 1, updated_at = ?
             WHERE id = ? AND status = 'pending_payment'`,
          )
          .bind(now, now, row.ticket_id),
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
    const full = object.refunded === true || (object.amount_refunded ?? 0) >= row.amount;
    outcome = full ? "refunded" : "partially_refunded";
    if (full && row.status === "paid")
      statements.push(
        db
          .prepare(
            "UPDATE registration_tickets SET status = 'refunded', revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'paid'",
          )
          .bind(now, row.ticket_id),
      );
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
    ...(await prepareStripePaymentEvent(db, "event", event, outcome === "rejected_mismatch" ? outcome : null)),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    // A concurrent delivery of the same event won the primary key.
    if (error instanceof Error && /UNIQUE constraint failed: registration_ticket_payment_events/.test(error.message))
      return { received: true, outcome: "duplicate" };
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
      .prepare("UPDATE email_outbox SET send_after = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
      .bind(HELD_UNTIL_PAID, now, input.outboxId),
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
