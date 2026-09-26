import type { z } from "zod";
import { stripeEventEnvelopeSchema } from "../../../../assets/shared/schemas/stripe";
import { membershipPaymentEventSchema } from "../../../../assets/shared/schemas/membership-payments";
import { sponsorshipCheckoutWebhookEnvelopeSchema } from "../../../../assets/shared/schemas/sponsorship";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { handleDonationStripeEvent } from "../donations/stripe-webhook";
import { handleMembershipPaymentEvent } from "../membership/workflows/fee-events";
import { handleSponsorshipStripeEvent } from "../sponsorship/stripe-webhook";
import { recordStripePaymentEvent } from "./ledger";

type StripeEvent = z.infer<typeof stripeEventEnvelopeSchema>;
type PaymentPurpose = "donation" | "membership" | "sponsorship";

interface StripeObjectIdentity {
  id?: string;
  payment_intent?: string | null;
  metadata?: Record<string, string> | null;
}

function objectIdentity(event: StripeEvent): StripeObjectIdentity {
  if (!event.data.object || typeof event.data.object !== "object" || Array.isArray(event.data.object)) return {};
  const value = event.data.object as Record<string, unknown>;
  const metadata =
    value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
      ? Object.fromEntries(
          Object.entries(value.metadata).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
      : null;
  return {
    id: typeof value.id === "string" ? value.id : undefined,
    payment_intent:
      typeof value.payment_intent === "string" || value.payment_intent === null ? value.payment_intent : undefined,
    metadata,
  };
}

async function persistedPurpose(db: DatabaseLike, identity: StripeObjectIdentity): Promise<PaymentPurpose | null> {
  if (identity.id?.startsWith("cs_")) {
    const row = await first<{ purpose: PaymentPurpose }>(
      db,
      `SELECT 'membership' AS purpose FROM membership_fee_checkouts WHERE provider_session_id = ?
       UNION ALL SELECT 'donation' AS purpose FROM donations WHERE checkout_session_id = ?
       UNION ALL SELECT 'sponsorship' AS purpose FROM sponsorships WHERE checkout_session_id = ?
       UNION ALL SELECT purpose FROM payment_ledger_entries
         WHERE provider = 'stripe' AND provider_checkout_session_id = ?
           AND purpose IN ('donation', 'membership', 'sponsorship')
       LIMIT 1`,
      [identity.id, identity.id, identity.id, identity.id],
    );
    if (row) return row.purpose;
  }
  if (identity.payment_intent) {
    const row = await first<{ purpose: PaymentPurpose }>(
      db,
      `SELECT 'membership' AS purpose FROM membership_fee_intents WHERE payment_intent_id = ?
       UNION ALL SELECT 'donation' AS purpose FROM donations WHERE payment_intent_id = ?
       UNION ALL SELECT purpose FROM payment_ledger_entries
         WHERE provider = 'stripe' AND provider_payment_intent_id = ?
           AND purpose IN ('donation', 'membership', 'sponsorship')
       LIMIT 1`,
      [identity.payment_intent, identity.payment_intent, identity.payment_intent],
    );
    if (row) return row.purpose;
  }
  return null;
}

async function paymentPurpose(db: DatabaseLike, event: StripeEvent): Promise<PaymentPurpose | null> {
  const identity = objectIdentity(event);
  const declared = identity.metadata?.pkic_payment_type;
  if (declared === "donation" || declared === "membership" || declared === "sponsorship") return declared;
  if (declared) return null;
  const persisted = await persistedPurpose(db, identity);
  if (persisted) return persisted;
  if (identity.metadata?.membershipFeeId && identity.metadata.membershipCheckoutId) return "membership";
  if (identity.metadata?.checkout_attempt_id && identity.metadata.event_id && identity.metadata.tier)
    return "sponsorship";
  if (identity.metadata?.donor_name || identity.metadata?.donor_email) return "donation";
  if (["charge.refunded", "charge.dispute.created", "charge.dispute.closed"].includes(event.type)) return "membership";
  return null;
}

export async function dispatchStripePaymentEvent(
  db: DatabaseLike,
  env: Env,
  event: StripeEvent,
  appBaseUrl: string,
  waitUntil: (promise: Promise<unknown>) => void,
) {
  const purpose = await paymentPurpose(db, event);
  if (!purpose) return { received: true, ignored: true };
  if (purpose === "donation") {
    const result = await handleDonationStripeEvent(db, env, event, appBaseUrl);
    const response = { ...result.body, outboxIds: result.outboxIds };
    await recordStripePaymentEvent(db, purpose, event, null);
    return response;
  }
  if (purpose === "membership") {
    const parsed = membershipPaymentEventSchema.safeParse(event);
    if (!parsed.success)
      throw new AppError(400, "INVALID_STRIPE_EVENT", "Invalid membership payment event", {
        issues: parsed.error.issues,
      });
    const result = await handleMembershipPaymentEvent(db, parsed.data, appBaseUrl);
    await recordStripePaymentEvent(
      db,
      purpose,
      event,
      "outcome" in result && typeof result.outcome === "string" ? result.outcome : null,
    );
    return result;
  }
  const parsed = sponsorshipCheckoutWebhookEnvelopeSchema.safeParse(event);
  if (!parsed.success)
    throw new AppError(400, "INVALID_STRIPE_EVENT", "Invalid sponsorship payment event", {
      issues: parsed.error.issues,
    });
  const result = await handleSponsorshipStripeEvent(db, env, parsed.data, appBaseUrl, waitUntil);
  await recordStripePaymentEvent(db, purpose, event, null);
  return result;
}
