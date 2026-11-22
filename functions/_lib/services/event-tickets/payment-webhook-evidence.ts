import type { z } from "zod";
import type { stripeEventEnvelopeSchema } from "../../../../assets/shared/schemas/stripe";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";

export type StripeEvent = z.infer<typeof stripeEventEnvelopeSchema>;

export interface StripeObjectFields {
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

export function stripeObjectFields(event: StripeEvent): StripeObjectFields {
  const value = event.data.object;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as StripeObjectFields) : {};
}

/** Identify a ticket event through its declared purpose or a recorded Checkout session or payment intent. */
export async function isEventTicketStripeEvent(db: DatabaseLike, event: StripeEvent): Promise<boolean> {
  const object = stripeObjectFields(event);
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

export interface SettlementRow {
  ticket_id: string;
  checkout_id: string;
  amount: number;
  currency: string;
  status: string;
  payment_intent_id: string | null;
  checkout_payment_intent_id: string | null;
  paid_amount: number;
  held_email_id: string | null;
  request_params: string | null;
  recorded: number;
  needs_review: number;
}

/** A provider timestamp in seconds as a UTC instant; null when it is not one. */
export const providerInstant = (seconds: unknown): string | null =>
  typeof seconds === "number" && Number.isInteger(seconds) && seconds >= 0
    ? new Date(seconds * 1000).toISOString()
    : null;

/** Stripe's events about one refund, by whichever name the account's API version sends them. */
export const REFUND_EVENT_TYPES = ["refund.updated", "refund.failed", "charge.refund.updated"];

/** How a dispute closes when the payment stays with the event: won, or an inquiry closed without a chargeback. */
export const DISPUTE_KEPT_STATUSES = ["won", "warning_closed"];
