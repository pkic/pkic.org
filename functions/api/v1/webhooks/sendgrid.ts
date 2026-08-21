/**
 * Signed SendGrid Event Webhook adapter. Raw-byte signature verification,
 * event validation, environment isolation, and set-based D1 processing are
 * deliberately separate so this route owns only HTTP concerns.
 */
import { OpenAPIRoute } from "chanfana";
import {
  sendgridEventBatchSchema,
  sendgridWebhookPostRouteSchema,
} from "../../../../assets/shared/schemas/route-contracts-webhooks";
import { json } from "../../../_lib/http";
import { readBoundedBody, SENDGRID_WEBHOOK_MAX_BYTES } from "../../../_lib/http-body";
import { logError } from "../../../_lib/logging";
import { processSendgridEvents } from "../../../_lib/services/sendgrid-webhook/processing";
import {
  isLoopbackOrigin,
  normalizeOrigin,
  verifySendgridSignature,
} from "../../../_lib/services/sendgrid-webhook/signature";
import type { Env } from "../../../_lib/types";

async function onRequestPost(c: any): Promise<Response> {
  const env = c.env as Env;
  const request = c.req.raw as Request;
  const bodyBytes = await readBoundedBody(request, SENDGRID_WEBHOOK_MAX_BYTES);
  const rawBody = bodyBytes.buffer.slice(
    bodyBytes.byteOffset,
    bodyBytes.byteOffset + bodyBytes.byteLength,
  ) as ArrayBuffer;
  const configuredOrigin = normalizeOrigin(env.APP_BASE_URL) ?? new URL(request.url).origin;
  const localDevelopment = isLoopbackOrigin(configuredOrigin);

  if (!env.SENDGRID_WEBHOOK_VERIFICATION_KEY && !localDevelopment) {
    logError("SENDGRID_WEBHOOK_VERIFICATION_NOT_CONFIGURED", { configuredOrigin });
    return json({ error: "Webhook not configured" }, 503);
  }

  if (env.SENDGRID_WEBHOOK_VERIFICATION_KEY) {
    const signature = request.headers.get("X-Twilio-Email-Event-Webhook-Signature") ?? "";
    const timestamp = request.headers.get("X-Twilio-Email-Event-Webhook-Timestamp") ?? "";
    if (!signature || !timestamp) return json({ error: "Missing signature headers" }, 400);
    if (!(await verifySendgridSignature(rawBody, signature, timestamp, env.SENDGRID_WEBHOOK_VERIFICATION_KEY))) {
      return json({ error: "Invalid or stale signature" }, 403);
    }
  }

  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes));
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = sendgridEventBatchSchema.safeParse(input);
  if (!parsed.success) {
    return json({ error: "Invalid SendGrid event batch", details: parsed.error.issues }, 400);
  }
  if (!env.DB) return json({ error: "Database not configured" }, 500);

  try {
    const result = await processSendgridEvents(env, parsed.data);
    return json({ received: parsed.data.length, ...result });
  } catch (error) {
    logError("SENDGRID_WEBHOOK_BATCH_ERROR", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export class WebhooksSendgridPost extends OpenAPIRoute {
  schema = sendgridWebhookPostRouteSchema;

  async handle(c: any) {
    return onRequestPost(c);
  }
}
