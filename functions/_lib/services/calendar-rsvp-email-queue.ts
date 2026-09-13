import { queuedRsvpEmailSchema, type QueuedRsvpEmail } from "../../../assets/shared/schemas/calendar-rsvp-email-queue";
import { z } from "zod";
import { getAvailability } from "../availability";
import { getRsvpInboundEmailMaxBytes } from "../config";
import { AppError } from "../errors";
import { verifySignedRsvpAddressFull } from "../email/rsvp";
import { readBoundedStream } from "../utils/bounded-stream";
import { nowIso } from "../utils/time";
import type { Env } from "../types";
import { processIncomingEmail, type IncomingRsvpEmail } from "./calendar-rsvp-email-ingest";

const envelopeSchema = z.object({ from: z.string().max(320), to: z.string().min(1).max(320) });
const payloadKey = (id: string) => `rsvp/pending/${id}.eml`;
const receiptKey = (id: string) => `rsvp/processed/${id}.json`;

export function usesRsvpEmailQueue(env: Env): boolean {
  if (env.RSVP_EMAIL_QUEUE_ENABLED === undefined || env.RSVP_EMAIL_QUEUE_ENABLED === "false") return false;
  if (env.RSVP_EMAIL_QUEUE_ENABLED !== "true" || !env.RSVP_EMAIL_QUEUE || !env.RSVP_EMAIL_BUCKET)
    throw new AppError(503, "EMAIL_QUEUE_NOT_CONFIGURED", "Durable RSVP processing is not configured");
  return true;
}

/** Accept only after both the private MIME object and its queue reference have been stored. */
export async function enqueueRsvpEmail(message: IncomingRsvpEmail, env: Env): Promise<void> {
  if (!usesRsvpEmailQueue(env)) throw new AppError(503, "EMAIL_QUEUE_DISABLED", "Durable RSVP processing is disabled");
  if (!env.INTERNAL_SIGNING_SECRET)
    throw new AppError(503, "EMAIL_SIGNING_NOT_CONFIGURED", "RSVP signing is not configured");
  // Do not let arbitrary recipients turn the inbound route into an object-storage sink.
  if (!(await verifySignedRsvpAddressFull(message.to, env.INTERNAL_SIGNING_SECRET, env.RSVP_EMAIL))) return;
  const envelope = envelopeSchema.parse({ from: message.from, to: message.to });
  const maxBytes = getRsvpInboundEmailMaxBytes(env);
  if (!Number.isSafeInteger(message.rawSize) || message.rawSize < 0 || message.rawSize > maxBytes)
    throw new AppError(413, "EMAIL_TOO_LARGE", "Inbound RSVP email exceeds the configured size limit");
  const body = await readBoundedStream(message.raw, maxBytes);
  if (!body.ok) throw new AppError(413, "EMAIL_TOO_LARGE", "Inbound RSVP email exceeds the configured size limit");
  const queued: QueuedRsvpEmail = { version: 1, id: crypto.randomUUID() };
  await env.RSVP_EMAIL_BUCKET!.put(payloadKey(queued.id), body.bytes, {
    httpMetadata: { contentType: "message/rfc822" },
    customMetadata: { ...envelope, receivedAt: nowIso() },
  });
  // A failed/ambiguous enqueue deliberately leaves the payload for operator recovery and lifecycle cleanup.
  // Deleting it here could destroy a message that Queues actually accepted before the response was lost.
  try {
    await env.RSVP_EMAIL_QUEUE!.send(queued);
  } catch (error) {
    console.error("RSVP_EMAIL_ENQUEUE_FAILED", { id: queued.id });
    throw error;
  }
}

export async function consumeRsvpEmails(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      if (!usesRsvpEmailQueue(env) || getAvailability(env, Date.now(), "email").mode !== "normal") {
        message.retry({ delaySeconds: 3600 });
        continue;
      }
      const queued = queuedRsvpEmailSchema.parse(message.body);
      const bucket = env.RSVP_EMAIL_BUCKET!;
      if (!(await bucket.head(receiptKey(queued.id)))) {
        const payload = await bucket.get(payloadKey(queued.id));
        if (!payload) throw new AppError(503, "EMAIL_PAYLOAD_MISSING", "Queued RSVP payload is unavailable");
        const envelope = envelopeSchema.parse(payload.customMetadata);
        // The producer already authenticated this address. Configuration drift must
        // retain accepted mail for recovery rather than turn the ingest no-op into success.
        if (
          !env.INTERNAL_SIGNING_SECRET ||
          !(await verifySignedRsvpAddressFull(envelope.to, env.INTERNAL_SIGNING_SECRET, env.RSVP_EMAIL))
        )
          throw new AppError(503, "EMAIL_SIGNING_CHANGED", "Queued RSVP signing configuration is unavailable");
        await processIncomingEmail({ ...envelope, raw: payload.body, rawSize: payload.size }, env);
        // D1's RSVP deduplication covers a crash after recording the event but before writing this receipt.
        await bucket.put(receiptKey(queued.id), JSON.stringify({ processedAt: nowIso() }), {
          httpMetadata: { contentType: "application/json" },
        });
      }
      await bucket.delete(payloadKey(queued.id));
      message.ack();
    } catch (error) {
      console.error("RSVP_EMAIL_RETRY", {
        messageId: message.id,
        attempt: message.attempts,
        code: error instanceof AppError ? error.code : "PROCESSING_FAILED",
      });
      // A bounded retry policy and dead-letter queue own subsequent delivery; no local sleep or write replay loop.
      message.retry({ delaySeconds: Math.min(3600, 60 * 2 ** Math.min(message.attempts, 6)) });
    }
  }
}
