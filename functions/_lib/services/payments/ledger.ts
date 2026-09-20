import type { z } from "zod";
import type { stripeEventEnvelopeSchema } from "../../../../assets/shared/schemas/stripe";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";

type StripeEvent = z.infer<typeof stripeEventEnvelopeSchema>;
type PaymentPurpose = "donation" | "membership" | "sponsorship" | "event";
type PaymentStatus =
  "pending" | "processing" | "paid" | "failed" | "expired" | "refunded" | "disputed" | "cancelled" | "requires_review";

interface LedgerEntryRow {
  id: string;
  status: PaymentStatus;
}

interface DomainPaymentRow {
  resource_type: string;
  resource_id: string;
  amount: number | null;
  currency: string | null;
  status: string;
  paid_at: string | null;
  checkout_session_id: string | null;
  payment_intent_id: string | null;
}

interface StripeObject {
  id?: string;
  payment_intent?: string | null;
  amount?: number | null;
  amount_total?: number | null;
  currency?: string | null;
  payment_status?: string | null;
  status?: string | null;
  metadata?: Record<string, string> | null;
}

function stripeObject(event: StripeEvent): StripeObject {
  const value = event.data.object;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const object = value as Record<string, unknown>;
  const metadata =
    object.metadata && typeof object.metadata === "object" && !Array.isArray(object.metadata)
      ? Object.fromEntries(
          Object.entries(object.metadata).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
      : null;
  return {
    id: typeof object.id === "string" ? object.id : undefined,
    payment_intent:
      typeof object.payment_intent === "string" || object.payment_intent === null ? object.payment_intent : undefined,
    amount: typeof object.amount === "number" ? object.amount : null,
    amount_total: typeof object.amount_total === "number" ? object.amount_total : null,
    currency: typeof object.currency === "string" ? object.currency.toLowerCase() : null,
    payment_status: typeof object.payment_status === "string" ? object.payment_status : null,
    status: typeof object.status === "string" ? object.status : null,
    metadata,
  };
}

function eventCreated(event: StripeEvent): number | null {
  const created = (event as StripeEvent & { created?: unknown }).created;
  return typeof created === "number" && Number.isInteger(created) && created >= 0 ? created : null;
}

function financialStatus(event: StripeEvent, object: StripeObject, domainOutcome: string | null): PaymentStatus | null {
  if (domainOutcome === "rejected_mismatch") return "requires_review";
  switch (event.type) {
    case "checkout.session.completed":
      return object.payment_status === "paid" ? "paid" : "processing";
    case "checkout.session.async_payment_succeeded":
      return "paid";
    case "checkout.session.async_payment_failed":
      return "failed";
    case "checkout.session.expired":
      return "expired";
    case "charge.refunded":
      return "refunded";
    case "charge.dispute.created":
      return "disputed";
    case "charge.dispute.closed":
      return object.status === "won" ? "paid" : "disputed";
    default:
      return null;
  }
}

function domainFinancialStatus(domain: DomainPaymentRow | null, eventType: string): PaymentStatus | null {
  if (!domain || eventType.startsWith("charge.")) return null;
  switch (domain.status) {
    case "completed":
      return "paid";
    case "paid":
      return domain.resource_type !== "membership_fee" || domain.payment_intent_id ? "paid" : null;
    case "awaiting_payment":
      return "processing";
    case "failed":
      return "failed";
    case "expired":
      return "expired";
    default:
      return null;
  }
}

async function domainPayment(
  db: DatabaseLike,
  purpose: PaymentPurpose,
  object: StripeObject,
): Promise<DomainPaymentRow | null> {
  if (purpose === "donation" && object.id) {
    return first<DomainPaymentRow>(
      db,
      `SELECT 'donation' AS resource_type, id AS resource_id, gross_amount AS amount,
       lower(currency) AS currency, status, completed_at AS paid_at,
       checkout_session_id, payment_intent_id
       FROM donations WHERE checkout_session_id = ? LIMIT 1`,
      [object.id],
    );
  }
  if (purpose === "membership") {
    const feeId = object.metadata?.membershipFeeId;
    if (feeId) {
      const byFee = await first<DomainPaymentRow>(
        db,
        `SELECT 'membership_fee' AS resource_type, id AS resource_id, amount, lower(currency) AS currency,
         status, paid_at, checkout_session_id, payment_intent_id
         FROM membership_fee_intents WHERE id = ? LIMIT 1`,
        [feeId],
      );
      if (byFee) return byFee;
    }
  }
  if (purpose === "sponsorship" && object.id) {
    return first<DomainPaymentRow>(
      db,
      `SELECT 'sponsorship' AS resource_type, id AS resource_id, price_amount_cents AS amount,
       lower(price_currency) AS currency, 'paid' AS status, created_at AS paid_at,
       checkout_session_id, NULL AS payment_intent_id
       FROM sponsorships WHERE checkout_session_id = ? LIMIT 1`,
      [object.id],
    );
  }
  if (object.payment_intent) {
    return first<DomainPaymentRow>(
      db,
      `SELECT 'membership_fee' AS resource_type, id AS resource_id, amount, lower(currency) AS currency,
       status, paid_at, checkout_session_id, payment_intent_id
       FROM membership_fee_intents WHERE payment_intent_id = ?
       UNION ALL
       SELECT 'donation', id, gross_amount, lower(currency), status, completed_at,
       checkout_session_id, payment_intent_id FROM donations WHERE payment_intent_id = ?
       LIMIT 1`,
      [object.payment_intent, object.payment_intent],
    );
  }
  return null;
}

async function existingEntry(
  db: DatabaseLike,
  purpose: PaymentPurpose,
  object: StripeObject,
  domain: DomainPaymentRow | null,
): Promise<LedgerEntryRow | null> {
  if (domain) {
    const byResource = await first<LedgerEntryRow>(
      db,
      `SELECT id, status FROM payment_ledger_entries
       WHERE purpose = ? AND resource_type = ? AND resource_id = ?
         AND (provider = 'stripe' OR provider IS NULL)
       ORDER BY CASE provider WHEN 'stripe' THEN 0 ELSE 1 END, created_at, id LIMIT 1`,
      [purpose, domain.resource_type, domain.resource_id],
    );
    if (byResource) return byResource;
  }
  const checkoutSessionId = object.id?.startsWith("cs_") ? object.id : null;
  if (checkoutSessionId) {
    const byCheckout = await first<LedgerEntryRow>(
      db,
      "SELECT id, status FROM payment_ledger_entries WHERE provider = 'stripe' AND provider_checkout_session_id = ? LIMIT 1",
      [checkoutSessionId],
    );
    if (byCheckout) return byCheckout;
  }
  if (object.payment_intent) {
    return first<LedgerEntryRow>(
      db,
      "SELECT id, status FROM payment_ledger_entries WHERE provider = 'stripe' AND provider_payment_intent_id = ? LIMIT 1",
      [object.payment_intent],
    );
  }
  return null;
}

function newEntryId(purpose: PaymentPurpose, object: StripeObject, domain: DomainPaymentRow | null): string | null {
  if (domain) return `payment:${purpose}:${domain.resource_id}`;
  if (object.id?.startsWith("cs_")) return `payment:stripe:checkout:${object.id}`;
  if (object.payment_intent) return `payment:stripe:intent:${object.payment_intent}`;
  return null;
}

/** Record a verified Stripe event after its domain handler accepts it. */
export async function recordStripePaymentEvent(
  db: DatabaseLike,
  purpose: PaymentPurpose,
  event: StripeEvent,
  domainOutcome: string | null = null,
): Promise<void> {
  if (!event.id) return;
  const object = stripeObject(event);
  const providerStatus = financialStatus(event, object, domainOutcome);
  if (!providerStatus) return;
  const domain = await domainPayment(db, purpose, object);
  const nextStatus =
    domainOutcome === "rejected_mismatch"
      ? "requires_review"
      : (domainFinancialStatus(domain, event.type) ?? providerStatus);
  const existing = await existingEntry(db, purpose, object, domain);
  const paymentId = existing?.id ?? newEntryId(purpose, object, domain);
  if (!paymentId) return;

  const now = nowIso();
  const created = eventCreated(event);
  const occurredAt = created === null ? now : new Date(created * 1000).toISOString();
  const checkoutSessionId = object.id?.startsWith("cs_") ? object.id : (domain?.checkout_session_id ?? null);
  const paymentIntentId = object.payment_intent ?? domain?.payment_intent_id ?? null;
  const amount = domain?.amount ?? object.amount_total ?? object.amount ?? null;
  const currency = domain?.currency ?? object.currency ?? null;
  const paidAt = nextStatus === "paid" ? (domain?.paid_at ?? occurredAt) : (domain?.paid_at ?? null);
  const resourceType = domain?.resource_type ?? (purpose === "membership" ? "membership_fee" : purpose);
  const resourceId = domain?.resource_id ?? null;
  const eventOrdinal = created ?? 0;

  await db.batch([
    db
      .prepare(
        `INSERT INTO payment_ledger_entries
          (id, purpose, resource_type, resource_id, provider, status, amount, currency,
           provider_checkout_session_id, provider_payment_intent_id, latest_provider_event_created,
           latest_provider_event_id, paid_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'stripe', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        paymentId,
        purpose,
        resourceType,
        resourceId,
        nextStatus,
        amount,
        currency,
        checkoutSessionId,
        paymentIntentId,
        eventOrdinal,
        event.id,
        paidAt,
        now,
        now,
      ),
    db
      .prepare(
        `UPDATE payment_ledger_entries SET
           resource_type = COALESCE(resource_type, ?), resource_id = COALESCE(resource_id, ?),
           provider = 'stripe', provider_checkout_session_id = COALESCE(provider_checkout_session_id, ?),
           provider_payment_intent_id = COALESCE(provider_payment_intent_id, ?)
         WHERE id = ?`,
      )
      .bind(resourceType, resourceId, checkoutSessionId, paymentIntentId, paymentId),
    db
      .prepare(
        `UPDATE payment_ledger_entries SET status = ?, amount = COALESCE(?, amount),
           currency = COALESCE(?, currency), paid_at = COALESCE(?, paid_at),
           latest_provider_event_created = ?, latest_provider_event_id = ?, updated_at = ?
         WHERE id = ? AND (
           latest_provider_event_created IS NULL OR latest_provider_event_created < ? OR
           (latest_provider_event_created = ? AND (
             latest_provider_event_id = ? OR status IN ('pending', 'processing') OR
             ? NOT IN ('pending', 'processing')
           ))
         )`,
      )
      .bind(
        nextStatus,
        amount,
        currency,
        paidAt,
        eventOrdinal,
        event.id,
        now,
        paymentId,
        eventOrdinal,
        eventOrdinal,
        event.id,
        nextStatus,
      ),
    db
      .prepare(
        `INSERT INTO payment_ledger_events
          (id, payment_id, source, external_event_id, event_type, from_status, to_status,
           domain_outcome, amount, currency, occurred_at, created_at)
         VALUES (?, ?, 'stripe', ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        `payment-event:stripe:${event.id}`,
        paymentId,
        event.id,
        event.type,
        existing?.status ?? null,
        nextStatus,
        domainOutcome,
        amount,
        currency,
        occurredAt,
        now,
      ),
  ]);
}
