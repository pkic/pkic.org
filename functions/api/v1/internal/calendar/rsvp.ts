/**
 * POST /api/v1/internal/calendar/rsvp
 *
 * Internal endpoint for processing calendar RSVP events from email ingestion.
 * Requires HMAC-SHA256 signature validation using INTERNAL_SIGNING_SECRET.
 *
 * Body (application/json):
 *   provider         — source provider (e.g., "cloudflare_email_route")
 *   sourceMessageId  — external message ID
 *   calendarIcs      — iCalendar RFC 5545 formatted string
 *
 * Headers:
 *   x-pkic-timestamp — Unix timestamp
 *   x-pkic-signature — HMAC-SHA256(secret, timestamp.body)
 */
import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { parseJsonBody } from "../../../../_lib/validation";
import { handleError, json } from "../../../../_lib/http";
import { AppError } from "../../../../_lib/errors";
import { hmacSha256Hex } from "../../../../_lib/utils/crypto";
// Support both formats: calendarIcs (full iCal format) and simplified format
const rsvpRequestSchema = z.union([
  z.object({
    provider: z.string(),
    sourceMessageId: z.string(),
    calendarIcs: z.string(),
    fromEmail: z.string().optional(),
  }),
  z.object({
    provider: z.string(),
    sourceMessageId: z.string(),
    uid: z.string(),
    partstat: z.enum(["ACCEPTED", "DECLINED", "TENTATIVE"]),
    attendeeEmail: z.string(),
  }),
]);

async function validateSignature(
  request: Request,
  secret: string,
): Promise<{ valid: boolean; error?: AppError }> {
  const timestamp = request.headers.get("x-pkic-timestamp");
  const signature = request.headers.get("x-pkic-signature");

  if (!timestamp || !signature) {
    return {
      valid: false,
      error: new AppError(401, "INVALID_SIGNATURE", "Missing signature headers"),
    };
  }

  const body = await request.clone().text();
  const expectedSig = await hmacSha256Hex(secret, `${timestamp}.${body}`);

  if (signature !== expectedSig) {
    return {
      valid: false,
      error: new AppError(401, "INVALID_SIGNATURE", "Signature verification failed"),
    };
  }

  return { valid: true };
}

export async function onRequestPost(c: any): Promise<Response> {
  const secret = c.env.INTERNAL_SIGNING_SECRET as string;

  if (!secret) {
    throw new AppError(401, "INVALID_SIGNATURE", "INTERNAL_SIGNING_SECRET not configured");
  }

  const validationResult = await validateSignature(c.req.raw, secret);
  if (!validationResult.valid) {
    throw validationResult.error || new AppError(401, "INVALID_SIGNATURE", "Signature validation failed");
  }

  const body = await parseJsonBody(c.req, rsvpRequestSchema);

  let uid: string;
  let partstat: string;
  let attendeeEmail: string;

  // Handle both calendarIcs format and simplified format
  if ("calendarIcs" in body) {
    const icsLines = body.calendarIcs.split("\r\n").map((line) => line.trim());
    const uidLine = icsLines.find((line) => line.startsWith("UID:"));
    const partstatLine = icsLines.find((line) => line.includes("PARTSTAT="));
    const attendeeLine = icsLines.find((line) => line.includes("ATTENDEE"));

    if (!uidLine || !partstatLine) {
      return json({ error: "Invalid calendar format" }, 400);
    }

    uid = uidLine.substring(4);
    partstat = partstatLine.includes("ACCEPTED")
      ? "ACCEPTED"
      : partstatLine.includes("DECLINED")
        ? "DECLINED"
        : "TENTATIVE";
    
    // Extract email from ATTENDEE line (e.g., "ATTENDEE;PARTSTAT=DECLINED:mailto:alice@example.com")
    const emailMatch = attendeeLine?.match(/mailto:(.+)$/);
    attendeeEmail = emailMatch ? emailMatch[1] : body.fromEmail || "";
  } else {
    uid = body.uid;
    partstat = body.partstat;
    attendeeEmail = body.attendeeEmail;
  }

  // Store RSVP in database
  try {
    const registrationIdMatch = uid.match(/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (registrationIdMatch) {
      const registrationId = registrationIdMatch[1];
      // Deduplicate by sourceMessageId to avoid processing same email multiple times
      const dedupeKey = `${registrationId}#${body.sourceMessageId}`;
      
      await c.env.DB.prepare(
        `INSERT INTO calendar_rsvp_events 
         (id, registration_id, ics_uid, attendee_email, response_status, provider, 
          source_message_id, dedupe_key, received_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
         ON CONFLICT(dedupe_key) DO UPDATE SET 
         response_status = excluded.response_status, updated_at = datetime('now')`,
      )
        .bind(
          crypto.randomUUID(),
          registrationId,
          uid,
          attendeeEmail,
          partstat.toLowerCase(),
          body.provider,
          body.sourceMessageId,
          dedupeKey,
        )
        .run();
    }
  } catch (err) {
    console.error("Failed to store RSVP", err);
  }

  return json({ processed: 1 });
}

export class InternalCalendarRsvpPost extends OpenAPIRoute {
  schema = {};

  async handle(c: any) {
    try {
      return await onRequestPost(c as any);
    } catch (error) {
      return handleError(error);
    }
  }
}
