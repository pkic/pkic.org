import { OpenAPIRoute } from "chanfana";
import { stripeEventEnvelopeSchema } from "../../../../assets/shared/schemas/stripe";
import { consolidatedStripeWebhookRouteSchema } from "../../../../assets/shared/schemas/stripe-webhook";
import { resolveAppBaseUrl } from "../../../_lib/config";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { processSelectedOutboxBackground } from "../../../_lib/email/outbox";
import { json } from "../../../_lib/http";
import { readBoundedTextBody, STRIPE_WEBHOOK_MAX_BYTES } from "../../../_lib/http-body";
import { verifyStripeWebhookSignature } from "../../../_lib/integrations/stripe/verify-webhook";
import { dispatchStripePaymentEvent } from "../../../_lib/services/payments/stripe-webhook";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  if (!c.env.STRIPE_WEBHOOK_SECRET) return json({ error: "Stripe webhook is not configured" }, 503);
  const raw = await readBoundedTextBody(c.req.raw, STRIPE_WEBHOOK_MAX_BYTES);
  const valid = await verifyStripeWebhookSignature(
    raw,
    c.req.raw.headers.get("stripe-signature") ?? "",
    c.env.STRIPE_WEBHOOK_SECRET,
  );
  if (!valid) return json({ error: "Invalid signature" }, 400);

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = stripeEventEnvelopeSchema.safeParse(decoded);
  if (!parsed.success) return json({ error: "Invalid Stripe event" }, 400);

  const waitUntil = (promise: Promise<unknown>) => c.executionCtx.waitUntil(promise);
  const result = await dispatchStripePaymentEvent(
    requestDb(c),
    c.env,
    parsed.data,
    resolveAppBaseUrl(c.env, c.req.raw),
    waitUntil,
  );
  if ("outboxIds" in result && result.outboxIds.length > 0) {
    waitUntil(processSelectedOutboxBackground(c.env.DB, c.env, result.outboxIds));
  }
  const { outboxIds: _outboxIds, ...body } = result as typeof result & { outboxIds?: string[] };
  return json(body);
}

export class StripeWebhookPost extends OpenAPIRoute {
  schema = consolidatedStripeWebhookRouteSchema;

  async handle(c: AdminContext) {
    return onRequestPost(c);
  }
}
