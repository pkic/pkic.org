/**
 * POST /api/v1/sponsors/checkouts
 *
 * self-service Stripe Checkout for event sponsorship
 * tiers. Mirrors functions/api/v1/donations/checkout.ts (raw Stripe REST
 * API, no SDK). Unlike donations, no `sponsorships` row is created here —
 * the record is created on successful payment (see
 * functions/api/v1/sponsors/checkouts/stripe.ts), keyed by the Stripe
 * checkout session id carried in the session metadata.
 */
import { resolveAppBaseUrl } from "../../../../_lib/config";
import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
import { assertSameOriginRequest } from "../../../../_lib/request-origin";
import { enforceRateLimit } from "../../../../_lib/rate-limit";
import { getClientIp } from "../../../../_lib/request";
import { getEventBySlug } from "../../../../_lib/services/events";
import { getActiveTierConfig, listTierConfig } from "../../../../_lib/services/sponsorship";
import { sponsorshipCheckoutRouteSchema } from "../../../../../assets/shared/schemas/sponsorship";
import type { SponsorshipCheckoutInput } from "../../../../../assets/shared/schemas/sponsorship";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { createStripeCheckoutSession } from "../../../../_lib/integrations/stripe/checkout";

export async function handleSponsorshipCheckout(c: any, data: { body: SponsorshipCheckoutInput }): Promise<Response> {
  c.set("sensitive", true);
  const env = c.env;
  const request = c.req.raw;
  const appBaseUrl = resolveAppBaseUrl(env, request);
  assertSameOriginRequest(request, appBaseUrl, "sponsorship_checkout");
  await enforceRateLimit({
    binding: env.IP_RATE_LIMITER,
    namespace: "sponsorship-checkout:ip",
    key: getClientIp(request),
  });

  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError(503, "SERVICE_UNAVAILABLE", "Sponsorship checkout is not configured");
  }

  const body = data.body;

  const tierConfig = await getActiveTierConfig(env.DB, "event", body.tier);
  if (!tierConfig) {
    const supportedTiers = (await listTierConfig(env.DB, "event")).filter((t) => t.active).map((t) => t.tier);
    throw new AppError(422, "UNKNOWN_TIER", `Unknown or unsupported sponsorship tier: ${body.tier}`, {
      supportedTiers,
    });
  }
  const unitAmount = tierConfig.amountCents;

  // body.eventId is the public event slug — resolved to the internal
  // events.id for storage in Stripe metadata, mirroring the inquiries
  // endpoint, so the webhook can write a valid sponsorships.event_id FK.
  const event = await getEventBySlug(env.DB, body.eventId);

  const successUrl = `${appBaseUrl}${body.successPath ?? "/sponsors/complete/"}?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${appBaseUrl}${body.cancelPath ?? "/sponsors/"}`;

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("line_items[0][price_data][currency]", tierConfig.currency);
  params.set("line_items[0][price_data][unit_amount]", String(unitAmount));
  params.set("line_items[0][price_data][product_data][name]", `PKI Consortium Event Sponsorship — ${body.tier}`);
  params.set("line_items[0][quantity]", "1");
  params.set("success_url", successUrl);
  params.set("cancel_url", cancelUrl);
  params.set("customer_email", body.contactEmail);
  params.set("metadata[checkout_attempt_id]", body.checkoutAttemptId);
  params.set("metadata[tier]", body.tier);
  params.set("metadata[contact_name]", body.contactName);
  params.set("metadata[contact_email]", body.contactEmail);
  params.set("metadata[event_id]", event.id);
  params.set("metadata[event_slug]", event.slug);
  params.set("metadata[price_amount_cents]", String(unitAmount));
  params.set("metadata[price_currency]", tierConfig.currency);
  if (body.organizationName) params.set("metadata[organization_name]", body.organizationName);

  const session = await createStripeCheckoutSession(env.STRIPE_SECRET_KEY, params, {
    idempotencyKey: `sponsorship:${body.checkoutAttemptId}`,
  });
  if (!session.url) {
    throw new AppError(502, "STRIPE_ERROR", "Stripe did not return a checkout URL");
  }

  return json({ url: session.url });
}

export const SponsorCheckoutCreate = openApiRoute(sponsorshipCheckoutRouteSchema, handleSponsorshipCheckout);
