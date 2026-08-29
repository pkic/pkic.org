/**
 * POST /api/v1/sponsors/checkouts/stripe/events
 *
 * Stripe webhook for sponsorship self-service checkout.
 * Signature verification mirrors functions/api/v1/donations/payments/stripe/webhook.ts
 * (raw fetch + Web Crypto HMAC-SHA256, no SDK). Only
 * checkout.session.completed / async_payment_succeeded are handled — on
 * payment confirmation, the sponsorships record is created (idempotently,
 * keyed by checkout_session_id) at pipeline_stage=payment_pending, then the
 * brochure + staff-notification emails are queued, matching Path A.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../_lib/http";
import { readBoundedTextBody, STRIPE_WEBHOOK_MAX_BYTES } from "../../../../_lib/http-body";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { recordPaidSponsorshipCheckout } from "../../../../_lib/services/sponsorship";
import {
  paidSponsorshipCheckoutSessionSchema,
  sponsorshipCheckoutSessionStatusSchema,
  sponsorshipCheckoutWebhookEnvelopeSchema,
  sponsorshipCheckoutWebhookRouteSchema,
} from "../../../../../assets/shared/schemas/sponsorship";
import { verifyStripeWebhookSignature } from "../../../../_lib/integrations/stripe/verify-webhook";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import { buildManagementLink } from "../../../../_lib/services/management-links";

export async function onRequestPost(c: any): Promise<Response> {
  const env = c.env;
  const db = env.DB;
  const request = c.req.raw;

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return json({ error: "Webhook not configured" }, 503);
  }

  const rawBody = await readBoundedTextBody(request, STRIPE_WEBHOOK_MAX_BYTES);
  const sigHeader = request.headers.get("stripe-signature") ?? "";
  const valid = await verifyStripeWebhookSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    return json({ error: "Invalid signature" }, 400);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const envelope = sponsorshipCheckoutWebhookEnvelopeSchema.safeParse(decoded);
  if (!envelope.success) {
    return json({ error: "Invalid Stripe event payload" }, 400);
  }
  const event = envelope.data;

  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return json({ received: true });
  }

  const sessionStatus = sponsorshipCheckoutSessionStatusSchema.safeParse(event.data.object);
  if (!sessionStatus.success) {
    return json({ error: "Invalid Stripe checkout session payload" }, 400);
  }
  if (sessionStatus.data.payment_status !== "paid") {
    return json({ received: true, pending: true });
  }

  const paidSession = paidSponsorshipCheckoutSessionSchema.safeParse(event.data.object);
  if (!paidSession.success) {
    console.error("Sponsorship checkout webhook: invalid paid session payload", {
      eventId: event.id,
      sessionId: sessionStatus.data.id,
      issues: paidSession.error.issues,
    });
    return json({ error: "Invalid paid sponsorship checkout payload" }, 400);
  }
  const session = paidSession.data;
  const metadata = session.metadata;
  if (session.amount_total !== metadata.price_amount_cents || session.currency !== metadata.price_currency) {
    console.error("Sponsorship checkout webhook: price snapshot mismatch", {
      eventId: event.id,
      sessionId: session.id,
    });
    return json({ error: "Paid checkout does not match its price snapshot" }, 400);
  }

  const result = await recordPaidSponsorshipCheckout(db, {
    stripeEventId: event.id,
    checkoutSessionId: session.id,
    tier: metadata.tier,
    contactName: metadata.contact_name,
    contactEmail: metadata.contact_email,
    organizationName: metadata.organization_name ?? null,
    eventId: metadata.event_id,
    eventSlug: metadata.event_slug,
    priceAmountCents: session.amount_total,
    priceCurrency: session.currency,
    brochureUrl: env.SPONSORSHIP_BROCHURE_URL ?? "https://pkic.org/sponsors/",
    notificationEmail: env.SPONSORSHIP_NOTIFICATION_EMAIL ?? "sponsorships@pkic.org",
    managementUrl: buildManagementLink(resolveAppBaseUrl(env, request), { kind: "sponsorship-list" }),
  });
  for (const outboxId of result.outboxIds) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, env, outboxId));
  }

  return json({ received: true, duplicate: !result.created });
}

export class SponsorStripeEventsCreate extends OpenAPIRoute {
  schema = sponsorshipCheckoutWebhookRouteSchema;

  async handle(c: any) {
    return onRequestPost(c);
  }
}
