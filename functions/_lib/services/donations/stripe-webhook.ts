import {
  stripeCheckoutSessionSchema,
  stripeWebhookEnvelopeSchema,
} from "../../../../assets/shared/schemas/donation-webhook";
import { fetchStripePaymentDetails, type StripePaymentDetails } from "../../integrations/stripe/payment-details";
import { AppError } from "../../errors";
import {
  completeDonationFromStripe,
  markDonationAwaitingPayment,
  markDonationExpired,
  markDonationFailed,
  type StripeDonorIdentity,
} from "./lifecycle";
import { queueDonationNotification } from "./notifications";
import type { DatabaseLike, Env } from "../../types";
import type { z } from "zod";

type StripeWebhookEnvelope = z.infer<typeof stripeWebhookEnvelopeSchema>;

export interface DonationWebhookResult {
  body: { received: true; pending?: true };
  outboxIds: string[];
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function donorIdentity(session: z.infer<typeof stripeCheckoutSessionSchema>): StripeDonorIdentity {
  return {
    name: firstNonEmpty(session.metadata?.donor_name, session.customer_details?.name),
    email: firstNonEmpty(session.metadata?.donor_email, session.customer_email, session.customer_details?.email),
    organization: firstNonEmpty(session.metadata?.donor_organization),
    source: firstNonEmpty(session.metadata?.source),
  };
}

function emptyDetails(): StripePaymentDetails {
  return {
    netAmount: null,
    settledAmount: null,
    settledCurrency: null,
    paymentMethodType: null,
    paymentFailed: false,
  };
}

async function paymentDetails(env: Env, paymentIntentId: string | null): Promise<StripePaymentDetails> {
  if (!env.STRIPE_SECRET_KEY || !paymentIntentId) return emptyDetails();
  const result = await fetchStripePaymentDetails(env.STRIPE_SECRET_KEY, paymentIntentId);
  // The signed paid webhook is authoritative for donation completion. Stripe's
  // expanded payment-intent data is supplemental and can be backfilled later.
  return result.ok ? result.value : emptyDetails();
}

async function notify(
  db: DatabaseLike,
  env: Env,
  sessionId: string,
  kind: "thank_you" | "payment_failed" | "expired",
  appBaseUrl: string,
): Promise<string[]> {
  const id = await queueDonationNotification(db, env, sessionId, kind, appBaseUrl);
  return id ? [id] : [];
}

/** Donation webhook domain handler. Signature/raw-body concerns stay in the route adapter. */
export async function handleDonationStripeEvent(
  db: DatabaseLike,
  env: Env,
  event: StripeWebhookEnvelope,
  appBaseUrl: string,
): Promise<DonationWebhookResult> {
  const supported = new Set([
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
  ]);
  if (!supported.has(event.type)) return { body: { received: true }, outboxIds: [] };

  const parsedSession = stripeCheckoutSessionSchema.safeParse(event.data.object);
  if (!parsedSession.success) {
    throw new AppError(400, "INVALID_STRIPE_EVENT", "Invalid Stripe checkout session payload", {
      issues: parsedSession.error.issues,
    });
  }
  const session = parsedSession.data;

  if (event.type === "checkout.session.async_payment_failed") {
    await markDonationFailed(db, session.id, session.payment_method_types?.[0] ?? null);
    return {
      body: { received: true },
      outboxIds: await notify(db, env, session.id, "payment_failed", appBaseUrl),
    };
  }

  if (event.type === "checkout.session.expired") {
    await markDonationExpired(db, session.id);
    return {
      body: { received: true },
      outboxIds: await notify(db, env, session.id, "expired", appBaseUrl),
    };
  }

  if (session.payment_status !== "paid") {
    if (event.type === "checkout.session.completed" && session.payment_status === "unpaid") {
      await markDonationAwaitingPayment(
        db,
        session.id,
        session.payment_method_types?.[0] ?? null,
        session.expires_at ?? null,
      );
    }
    return { body: { received: true, pending: true }, outboxIds: [] };
  }

  const details = await paymentDetails(env, session.payment_intent);
  await completeDonationFromStripe(db, session, details, donorIdentity(session));
  return {
    body: { received: true },
    outboxIds: await notify(db, env, session.id, "thank_you", appBaseUrl),
  };
}
