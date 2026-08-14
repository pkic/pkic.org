/**
 * POST /api/v1/sponsorship/checkout/webhook
 *
 * Stripe webhook for sponsorship self-service checkout.
 * Signature verification mirrors functions/api/v1/webhooks/stripe.ts
 * (raw fetch + Web Crypto HMAC-SHA256, no SDK). Only
 * checkout.session.completed / async_payment_succeeded are handled — on
 * payment confirmation, the sponsorships record is created (idempotently,
 * keyed by checkout_session_id) at pipeline_stage=payment_pending, then the
 * brochure + staff-notification emails are queued, matching Path A.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../_lib/http";
import { queueEmail, processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { recordPaidSponsorshipCheckout } from "../../../../_lib/services/sponsorship";
import { sponsorshipCheckoutWebhookRouteSchema } from "../../../../../assets/shared/schemas/sponsorship";

const TOLERANCE_SECONDS = 300;

async function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string): Promise<boolean> {
  const parts: Record<string, string> = {};
  for (const part of signatureHeader.split(",")) {
    const idx = part.indexOf("=");
    if (idx !== -1) parts[part.slice(0, idx)] = part.slice(idx + 1);
  }
  const timestamp = parts["t"];
  const v1 = parts["v1"];
  if (!timestamp || !v1) return false;

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > TOLERANCE_SECONDS) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const computed = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (computed.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

interface StripeCheckoutSession {
  id: string;
  payment_status?: string | null;
  metadata?: Record<string, string> | null;
  amount_total?: number | null;
  currency?: string | null;
}

export async function onRequestPost(c: any): Promise<Response> {
  const env = c.env;
  const db = env.DB;
  const request = c.req.raw;

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return json({ error: "Webhook not configured" }, 503);
  }

  const rawBody = await request.text();
  const sigHeader = request.headers.get("stripe-signature") ?? "";
  const valid = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    return json({ error: "Invalid signature" }, 400);
  }

  let event: { type: string; data: { object: unknown } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return json({ received: true });
  }

  const session = event.data.object as StripeCheckoutSession;
  if (session.payment_status !== "paid") {
    return json({ received: true, pending: true });
  }

  const metadata = session.metadata ?? {};
  if (!metadata.tier || !metadata.contact_name || !metadata.contact_email) {
    console.error("Sponsorship checkout webhook: missing required metadata on session", session.id);
    return json({ received: true, skipped: true });
  }

  const sponsorship = await recordPaidSponsorshipCheckout(db, {
    checkoutSessionId: session.id,
    tier: metadata.tier,
    contactName: metadata.contact_name,
    contactEmail: metadata.contact_email,
    organizationName: metadata.organization_name ?? null,
    eventId: metadata.event_id ?? null,
    // Stripe's own reported amount/currency on the completed session — the
    // authoritative record of what was actually charged, not re-derived
    // from current tier config (which may have changed since checkout).
    priceAmountCents: session.amount_total ?? null,
    priceCurrency: session.currency ?? null,
  });

  const brochureOutboxId = await queueEmail(db, {
    templateKey: "sponsorship-brochure",
    recipientEmail: sponsorship.contact_email ?? metadata.contact_email,
    messageType: "transactional",
    subject: "PKI Consortium sponsorship information",
    data: {
      contactName: sponsorship.contact_name ?? metadata.contact_name,
      eventName: sponsorship.event_id ?? "",
      brochureUrl: env.SPONSORSHIP_BROCHURE_URL ?? "https://pkic.org/sponsors/",
    },
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(db, env, brochureOutboxId));

  const staffOutboxId = await queueEmail(db, {
    templateKey: "sponsorship-new-inquiry",
    recipientEmail: env.SPONSORSHIP_NOTIFICATION_EMAIL ?? "sponsorships@pkic.org",
    messageType: "transactional",
    subject: `New sponsorship inquiry: ${metadata.contact_name} (${metadata.organization_name ?? "n/a"})`,
    data: {
      contactName: metadata.contact_name,
      contactEmail: metadata.contact_email,
      organizationName: metadata.organization_name ?? "",
      sponsorType: "event",
      tier: metadata.tier,
      notes: "Paid via self-service Stripe checkout",
      adminUrl: "https://pkic.org/admin/",
    },
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(db, env, staffOutboxId));

  return json({ received: true });
}

export class SponsorshipCheckoutWebhookPost extends OpenAPIRoute {
  schema = sponsorshipCheckoutWebhookRouteSchema;

  async handle(c: any) {
    return onRequestPost(c);
  }
}
