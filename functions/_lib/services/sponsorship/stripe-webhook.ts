import type { z } from "zod";
import {
  paidSponsorshipCheckoutSessionSchema,
  sponsorshipCheckoutSessionStatusSchema,
  sponsorshipCheckoutWebhookEnvelopeSchema,
} from "../../../../assets/shared/schemas/sponsorship";
import { processOutboxByIdBackground } from "../../email/outbox";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { buildManagementLink } from "../management-links";
import { recordPaidSponsorshipCheckout } from "./checkout";

type SponsorshipStripeEvent = z.infer<typeof sponsorshipCheckoutWebhookEnvelopeSchema>;

export async function handleSponsorshipStripeEvent(
  db: DatabaseLike,
  env: Env,
  event: SponsorshipStripeEvent,
  appBaseUrl: string,
  waitUntil: (promise: Promise<unknown>) => void,
) {
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return { received: true, ignored: true };
  }
  const status = sponsorshipCheckoutSessionStatusSchema.safeParse(event.data.object);
  if (!status.success) throw new AppError(400, "INVALID_STRIPE_EVENT", "Invalid Stripe checkout session payload");
  if (status.data.payment_status !== "paid") return { received: true, pending: true };

  const paid = paidSponsorshipCheckoutSessionSchema.safeParse(event.data.object);
  if (!paid.success) {
    throw new AppError(400, "INVALID_STRIPE_EVENT", "Invalid paid sponsorship checkout payload", {
      issues: paid.error.issues,
    });
  }
  const session = paid.data;
  if (
    session.amount_total !== session.metadata.price_amount_cents ||
    session.currency !== session.metadata.price_currency
  ) {
    throw new AppError(400, "STRIPE_PAYMENT_MISMATCH", "Paid checkout does not match its price snapshot");
  }

  const result = await recordPaidSponsorshipCheckout(db, {
    stripeEventId: event.id,
    checkoutSessionId: session.id,
    tier: session.metadata.tier,
    contactName: session.metadata.contact_name,
    contactEmail: session.metadata.contact_email,
    organizationName: session.metadata.organization_name ?? null,
    eventId: session.metadata.event_id,
    eventSlug: session.metadata.event_slug,
    priceAmountCents: session.amount_total,
    priceCurrency: session.currency,
    brochureUrl: env.SPONSORSHIP_BROCHURE_URL ?? "https://pkic.org/sponsors/",
    notificationEmail: env.SPONSORSHIP_NOTIFICATION_EMAIL ?? "sponsorships@pkic.org",
    managementUrl: buildManagementLink(appBaseUrl, { kind: "sponsorship-list" }),
  });
  for (const outboxId of result.outboxIds) waitUntil(processOutboxByIdBackground(db, env, outboxId));
  return { received: true, duplicate: !result.created };
}
