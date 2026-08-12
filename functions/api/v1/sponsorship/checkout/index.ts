/**
 * POST /api/v1/sponsorship/checkout
 *
 * self-service Stripe Checkout for event sponsorship
 * tiers. Mirrors functions/api/v1/donations/checkout.ts (raw Stripe REST
 * API, no SDK). Unlike donations, no `sponsorships` row is created here —
 * the record is created on successful payment (see
 * functions/api/v1/sponsorship/checkout/webhook.ts), keyed by the Stripe
 * checkout session id carried in the session metadata.
 */
import { OpenAPIRoute } from "chanfana";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
import { parseJsonBody } from "../../../../_lib/validation";
import { getEventBySlug } from "../../../../_lib/services/events";
import { getActiveTierConfig, listTierConfig } from "../../../../_lib/services/sponsorship";
import {
  sponsorshipCheckoutRouteSchema,
  sponsorshipCheckoutSchema,
} from "../../../../../assets/shared/schemas/sponsorship";

const STRIPE_API = "https://api.stripe.com/v1/checkout/sessions";

export async function onRequestPost(c: any): Promise<Response> {
  c.set("sensitive", true);
  const env = c.env;
  const request = c.req.raw;
  const appBaseUrl = resolveAppBaseUrl(env, request);

  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError(503, "SERVICE_UNAVAILABLE", "Sponsorship checkout is not configured");
  }

  const body = await parseJsonBody(c.req, sponsorshipCheckoutSchema);

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
  params.set("metadata[tier]", body.tier);
  params.set("metadata[contact_name]", body.contactName);
  params.set("metadata[contact_email]", body.contactEmail);
  params.set("metadata[event_id]", event.id);
  if (body.organizationName) params.set("metadata[organization_name]", body.organizationName);

  const stripeResponse = await fetch(STRIPE_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!stripeResponse.ok) {
    const errBody = await stripeResponse.text();
    console.error("Stripe API error:", stripeResponse.status, errBody);
    throw new AppError(502, "STRIPE_ERROR", "Failed to create sponsorship checkout session");
  }

  const session = (await stripeResponse.json()) as { id: string; url?: string };
  if (!session.url) {
    throw new AppError(502, "STRIPE_ERROR", "Stripe did not return a checkout URL");
  }

  return json({ url: session.url });
}

export class SponsorshipCheckoutPost extends OpenAPIRoute {
  schema = sponsorshipCheckoutRouteSchema;

  async handle(c: any) {
    return onRequestPost(c);
  }
}
