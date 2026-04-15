/**
 * POST /api/v1/webhooks/sendgrid
 *
 * Handles SendGrid Event Webhook events. Processes:
 *   - bounce      — marks the outbox record as bounced (hard) or updates
 *                   last_error (soft)
 *   - deferred    — updates last_error with the delivery deferral reason
 *   - dropped     — marks as bounced (undeliverable before attempt)
 *   - spamreport  — marks as bounced + inserts into unsubscribes
 *   - delivered   — marks the outbox record as delivered
 *   - unsubscribe / group_unsubscribe — inserts into unsubscribes table
 *
 * Signature verification uses ECDSA P-256/SHA-256 via the Web Crypto API.
 * Obtain the public key from SendGrid's Mail Settings → Event Webhook page
 * (it appears after enabling "Signed Event Webhook") and store it as the
 * SENDGRID_WEBHOOK_VERIFICATION_KEY Wrangler secret.
 *
 * Per-environment setup: configure ONE Event Webhook subscription in SendGrid,
 * pointing to the production URL. Every outgoing email is stamped with the
 * sending environment's APP_BASE_URL via custom_args.env_url, and events
 * whose env_url does not match this environment are silently ignored — so a
 * single production endpoint handles all events without duplicating work.
 * Adding a second subscription for preview would cause every event to invoke
 * two Workers, doubling cost, so avoid it unless temporarily debugging.
 *
 * When SENDGRID_WEBHOOK_VERIFICATION_KEY is not set, signature verification
 * is skipped (useful for local dev / testing).
 *
 * Required SendGrid Event Webhook events to enable:
 *   Bounce, Deferred, Dropped, Spam Report, Delivered,
 *   Unsubscribe, Group Unsubscribe
 *
 * Wrangler secret: SENDGRID_WEBHOOK_VERIFICATION_KEY (base64 EC public key)
 *
 * Configure the webhook URL in SendGrid to:
 *   https://<your-domain>/api/v1/webhooks/sendgrid
 */

import { OpenAPIRoute } from "chanfana";
import { json } from "../../../_lib/http";
import type { Env } from "../../../_lib/types";
import { logInfo, logError } from "../../../_lib/logging";
import { prepareAuditLog, writeAuditLog } from "../../../_lib/services/audit";

interface SendgridEvent {
  event: string;
  sg_message_id?: string;
  email?: string;
  /** "hard" | "soft" — only present on `bounce` events */
  type?: string;
  reason?: string;
  status?: string;
  response?: string;
  timestamp?: number;
  /** Group ID for group_unsubscribe events */
  asm_group_id?: number;
  /** Custom args stamped when the email was sent — used to scope events to the originating environment */
  env_url?: string;
}

/**
 * Convert a DER-encoded ECDSA signature to IEEE P1363 format (r || s).
 * SendGrid provides DER signatures, but Web Crypto expects P1363.
 */
function derToP1363(der: Uint8Array, byteLength: number): Uint8Array {
  if (der[0] !== 0x30) throw new Error("Expected DER SEQUENCE");
  let offset = 2;
  // Handle multi-byte SEQUENCE length
  if (der[1] & 0x80) offset += der[1] & 0x7f;

  if (der[offset] !== 0x02) throw new Error("Expected INTEGER for r");
  const rLen = der[offset + 1];
  offset += 2;
  const r = der.subarray(offset, offset + rLen);
  offset += rLen;

  if (der[offset] !== 0x02) throw new Error("Expected INTEGER for s");
  const sLen = der[offset + 1];
  offset += 2;
  const s = der.subarray(offset, offset + sLen);

  const result = new Uint8Array(byteLength * 2);
  // Copy r, stripping any leading zero padding and right-aligning
  const rTrim = r.length > byteLength ? r.length - byteLength : 0;
  result.set(r.subarray(rTrim), byteLength - Math.min(r.length, byteLength));
  // Copy s the same way
  const sTrim = s.length > byteLength ? s.length - byteLength : 0;
  result.set(s.subarray(sTrim), byteLength + byteLength - Math.min(s.length, byteLength));

  return result;
}

/**
 * Verify a SendGrid signed event webhook signature using ECDSA P-256/SHA-256.
 * https://docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features
 */
async function verifySendgridSignature(
  body: string,
  signatureHeader: string,
  timestampHeader: string,
  publicKeyBase64: string,
): Promise<boolean> {
  try {
    // Strip PEM headers/footers and newlines in case the key was pasted as PEM
    const cleanKey = publicKeyBase64.replace(/-----[^-]+-----|[\r\n]/g, "");
    const pubKeyBytes = Uint8Array.from(atob(cleanKey), (c) => c.charCodeAt(0));

    const key = await crypto.subtle.importKey(
      "spki",
      pubKeyBytes.buffer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );

    // SendGrid sends DER-encoded signatures; Web Crypto expects P1363 (r || s)
    const derSigBytes = Uint8Array.from(atob(signatureHeader), (c) => c.charCodeAt(0));
    const sigBytes = derToP1363(derSigBytes, 32); // P-256 → 32-byte r, 32-byte s
    const dataBytes = new TextEncoder().encode(timestampHeader + body);

    return await crypto.subtle.verify(
      { name: "ECDSA", hash: { name: "SHA-256" } },
      key,
      sigBytes.buffer as ArrayBuffer,
      dataBytes,
    );
  } catch {
    return false;
  }
}

/**
 * SendGrid appends a filter suffix to the base message ID in event payloads
 * (e.g. "abc123.filter0"). Strip it so we can match against provider_message_id.
 */
function extractBaseMessageId(sgMessageId: string): string {
  const dotIndex = sgMessageId.indexOf(".");
  return dotIndex !== -1 ? sgMessageId.slice(0, dotIndex) : sgMessageId;
}

/**
 * Cancel any active registration for the user+event whose confirmation email bounced.
 * Without a working email the attendee cannot receive event details, so the seat is freed.
 */
async function cancelRegistrationDueToBounce(
  db: NonNullable<Env["DB"]>,
  providerMessageId: string,
  reason: string,
): Promise<void> {
  const outbox = await db.prepare(
    `SELECT recipient_user_id, event_id FROM email_outbox WHERE provider_message_id = ?`,
  ).bind(providerMessageId).first<{ recipient_user_id: string | null; event_id: string | null }>();

  if (!outbox?.recipient_user_id || !outbox?.event_id) return;

  const reg = await db.prepare(
    `SELECT id FROM registrations WHERE event_id = ? AND user_id = ? AND status != 'cancelled'`,
  ).bind(outbox.event_id, outbox.recipient_user_id).first<{ id: string }>();

  if (!reg) return;

  await db.batch([
    db.prepare(
      `UPDATE registrations SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`,
    ).bind(reg.id),
    prepareAuditLog(db, "system", null, "cancelled_bounce", "registration", reg.id, { reason }),
  ]);
  logInfo("REGISTRATION_CANCELLED_BOUNCE", { registrationId: reg.id, reason });
}

async function processSendgridEvent(env: Env, event: SendgridEvent): Promise<void> {
  const { event: eventType, sg_message_id, env_url } = event;
  if (!sg_message_id) return;

  // Only process events that were sent by this environment
  if (env.APP_BASE_URL && env_url && env_url !== env.APP_BASE_URL) {
    logInfo("SENDGRID_EVENT_SKIPPED_ENV", { eventType, env_url, expected: env.APP_BASE_URL });
    return;
  }

  const baseId = extractBaseMessageId(sg_message_id);
  logInfo("SENDGRID_EVENT", { eventType, baseId, bounceType: event.type });

  // Resolve the outbox row ID once for audit logging
  const outboxRow = await env.DB!.prepare(
    `SELECT id FROM email_outbox WHERE provider_message_id = ?`,
  ).bind(baseId).first<{ id: string }>();
  const outboxId = outboxRow?.id ?? null;

  switch (eventType) {
    case "bounce": {
      const isHard = event.type !== "soft";
      const reason = event.reason ?? event.status ?? "no reason given";
      if (isHard) {
        await env.DB!.prepare(
          `UPDATE email_outbox
           SET status = 'bounced', last_error = ?, updated_at = datetime('now')
           WHERE provider_message_id = ?`,
        ).bind(`Hard bounce: ${reason}`, baseId).run();
        await writeAuditLog(env.DB!, "system", null, "email_hard_bounce", "email_outbox", outboxId, { reason, baseId });
        await cancelRegistrationDueToBounce(env.DB!, baseId, `Hard bounce: ${reason}`);
      } else {
        await env.DB!.prepare(
          `UPDATE email_outbox
           SET last_error = ?, updated_at = datetime('now')
           WHERE provider_message_id = ? AND status != 'bounced'`,
        ).bind(`Soft bounce: ${reason}`, baseId).run();
        await writeAuditLog(env.DB!, "system", null, "email_soft_bounce", "email_outbox", outboxId, { reason, baseId });
      }
      break;
    }

    case "deferred": {
      const reason = event.response ?? event.reason ?? "no reason given";
      await env.DB!.prepare(
        `UPDATE email_outbox
         SET last_error = ?, updated_at = datetime('now')
         WHERE provider_message_id = ? AND status != 'bounced'`,
      ).bind(`Delivery deferred: ${reason}`, baseId).run();
      await writeAuditLog(env.DB!, "system", null, "email_deferred", "email_outbox", outboxId, { reason, baseId });
      break;
    }

    case "dropped": {
      const reason = event.reason ?? "no reason given";
      await env.DB!.prepare(
        `UPDATE email_outbox
         SET status = 'bounced', last_error = ?, updated_at = datetime('now')
         WHERE provider_message_id = ?`,
      ).bind(`Dropped: ${reason}`, baseId).run();
      await writeAuditLog(env.DB!, "system", null, "email_dropped", "email_outbox", outboxId, { reason, baseId });
      await cancelRegistrationDueToBounce(env.DB!, baseId, `Dropped: ${reason}`);
      break;
    }

    case "spamreport": {
      await env.DB!.prepare(
        `UPDATE email_outbox
         SET status = 'bounced', last_error = 'Spam report received', updated_at = datetime('now')
         WHERE provider_message_id = ?`,
      ).bind(baseId).run();
      await writeAuditLog(env.DB!, "system", null, "email_spam_report", "email_outbox", outboxId, { email: event.email, baseId });
      await cancelRegistrationDueToBounce(env.DB!, baseId, "Spam report received");
      if (event.email) {
        await env.DB!.prepare(
          `INSERT OR IGNORE INTO unsubscribes (id, email, channel, scope_type, scope_ref, reason, created_at)
           VALUES (?, ?, 'email', 'global', NULL, 'spam_report', datetime('now'))`,
        ).bind(crypto.randomUUID(), event.email).run();
      }
      break;
    }

    case "unsubscribe":
    case "group_unsubscribe": {
      if (event.email) {
        const channel = eventType === "group_unsubscribe" && event.asm_group_id
          ? `email_group_${event.asm_group_id}`
          : "email";
        await env.DB!.prepare(
          `INSERT OR IGNORE INTO unsubscribes (id, email, channel, scope_type, scope_ref, reason, created_at)
           VALUES (?, ?, ?, 'global', NULL, 'unsubscribed', datetime('now'))`,
        ).bind(crypto.randomUUID(), event.email, channel).run();
        await writeAuditLog(env.DB!, "system", null, "email_unsubscribe", "email_outbox", outboxId, { email: event.email, channel, baseId });
      }
      break;
    }

    case "delivered": {
      await env.DB!.prepare(
        `UPDATE email_outbox
         SET status = 'delivered', updated_at = datetime('now')
         WHERE provider_message_id = ? AND status = 'sent'`,
      ).bind(baseId).run();
      await writeAuditLog(env.DB!, "system", null, "email_delivered", "email_outbox", outboxId, { baseId });
      break;
    }
  }
}

async function onRequestPost(c: any): Promise<Response> {
  const env = c.env as Env;
  const request = c.req.raw as Request;

  const rawBody = await request.text();

  if (env.SENDGRID_WEBHOOK_VERIFICATION_KEY) {
    const sig = request.headers.get("X-Twilio-Email-Event-Webhook-Signature") ?? "";
    const ts = request.headers.get("X-Twilio-Email-Event-Webhook-Timestamp") ?? "";

    if (!sig || !ts) {
      return json({ error: "Missing signature headers" }, 400);
    }

    const valid = await verifySendgridSignature(
      rawBody,
      sig,
      ts,
      env.SENDGRID_WEBHOOK_VERIFICATION_KEY,
    );
    if (!valid) {
      return json({ error: "Invalid signature" }, 403);
    }
  }

  let events: SendgridEvent[];
  try {
    events = JSON.parse(rawBody);
    if (!Array.isArray(events)) {
      return json({ error: "Expected array of events" }, 400);
    }
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!env.DB) {
    return json({ error: "Database not configured" }, 500);
  }

  for (const event of events) {
    try {
      await processSendgridEvent(env, event);
    } catch (err) {
      logError("SENDGRID_WEBHOOK_EVENT_ERROR", {
        event: event.event,
        sgMessageId: event.sg_message_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return json({ received: events.length });
}

export class WebhooksSendgridPost extends OpenAPIRoute {
  schema = {};

  async handle(c: any) {
    return onRequestPost(c as any);
  }
}
