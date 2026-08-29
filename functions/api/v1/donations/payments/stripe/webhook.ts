import { OpenAPIRoute } from "chanfana";
import {
  stripeWebhookEnvelopeSchema,
  stripeWebhookPostRouteSchema,
} from "../../../../../../assets/shared/schemas/donation-webhook";
import { resolveAppBaseUrl } from "../../../../../../functions/_lib/config";
import { processSelectedOutboxBackground } from "../../../../../../functions/_lib/email/outbox";
import { json } from "../../../../../../functions/_lib/http";
import { readBoundedTextBody, STRIPE_WEBHOOK_MAX_BYTES } from "../../../../../../functions/_lib/http-body";
import { verifyStripeWebhookSignature } from "../../../../../../functions/_lib/integrations/stripe/verify-webhook";
import { handleDonationStripeEvent } from "../../../../../../functions/_lib/services/donations/stripe-webhook";
import type { Env } from "../../../../../../functions/_lib/types";

/** POST /api/v1/donations/payments/stripe/webhook.
 *
 * Raw-body adapter; payment state and notifications live in the donation domain.
 */
export async function onRequestPost(c: any): Promise<Response> {
  const env: Env = c.env;
  const request: Request = c.req.raw;
  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET is not configured");
    return json({ error: "Webhook not configured" }, 503);
  }

  const rawBody = await readBoundedTextBody(request, STRIPE_WEBHOOK_MAX_BYTES);
  const valid = await verifyStripeWebhookSignature(
    rawBody,
    request.headers.get("stripe-signature") ?? "",
    env.STRIPE_WEBHOOK_SECRET,
  );
  if (!valid) return json({ error: "Invalid signature" }, 400);

  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const event = stripeWebhookEnvelopeSchema.safeParse(decoded);
  if (!event.success) return json({ error: "Invalid Stripe event" }, 400);

  const result = await handleDonationStripeEvent(env.DB, env, event.data, resolveAppBaseUrl(env, request));
  if (result.outboxIds.length > 0) {
    c.executionCtx.waitUntil(processSelectedOutboxBackground(env.DB, env, result.outboxIds));
  }
  return json(result.body);
}

export class DonationsStripeWebhookPost extends OpenAPIRoute {
  schema = stripeWebhookPostRouteSchema;

  async handle(c: any) {
    return onRequestPost(c);
  }
}
