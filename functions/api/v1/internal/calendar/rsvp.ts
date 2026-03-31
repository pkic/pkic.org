import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
import { requireInternalSecret } from "../../../../_lib/request";
import { hmacSha256Hex } from "../../../../_lib/utils/crypto";
import { nowIso } from "../../../../_lib/utils/time";
import type { PagesContext } from "../../../../_lib/types";
import { internalCalendarRsvpIngestSchema } from "../../../../../assets/shared/schemas/api";

const SIGNATURE_TOLERANCE_SECONDS = 15 * 60;

type RsvpStatus = "accepted" | "declined" | "tentative" | "needs_action";

interface ParsedRsvpSignal {
  uid: string;
  status: RsvpStatus;
  attendeeEmail: string;
  method: string | null;
  sequence: number | null;
}

interface CalendarRsvpRecord {
  id: string;
}

function parseStatus(value: string | null | undefined): RsvpStatus | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === "ACCEPTED") return "accepted";
  if (normalized === "DECLINED") return "declined";
  if (normalized === "TENTATIVE") return "tentative";
  if (normalized === "NEEDS-ACTION" || normalized === "NEEDS_ACTION") return "needs_action";
  if (normalized === "CANCELLED" || normalized === "CANCELED") return "declined";
  return null;
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function unfoldIcs(content: string): string {
  return content.replace(/\r?\n[\t ]/g, "");
}

function parseIcsSignal(content: string): ParsedRsvpSignal {
  const unfolded = unfoldIcs(content);
  const uid = unfolded.match(/^UID(?:;[^:\r\n]*)?:(.+)$/im)?.[1]?.trim() ?? "";
  const method = unfolded.match(/^METHOD:(.+)$/im)?.[1]?.trim() ?? null;

  let sequence: number | null = null;
  const seqRaw = unfolded.match(/^SEQUENCE:(\d+)$/im)?.[1];
  if (seqRaw) {
    sequence = Number.parseInt(seqRaw, 10);
  }

  const attendeeLine = unfolded.match(/^ATTENDEE([^:\r\n]*):([^\r\n]+)$/im);
  const attendeeParams = attendeeLine?.[1] ?? "";
  const attendeeValue = attendeeLine?.[2] ?? "";
  const partstat = attendeeParams.match(/(?:^|;)PARTSTAT=([^;]+)/i)?.[1];
  const attendeeEmail = normalizeEmail(attendeeValue.match(/mailto:([^;\s]+)/i)?.[1] ?? "");

  const status = parseStatus(partstat);
  if (!uid || !status) {
    throw new AppError(400, "INVALID_RSVP_PAYLOAD", "calendarIcs does not include a valid UID and PARTSTAT");
  }

  return {
    uid,
    status,
    attendeeEmail,
    method,
    sequence,
  };
}

function registrationIdFromUid(uid: string): string | null {
  const match = uid.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:-\d{4}-\d{2}-\d{2})?@pkic\.org$/i,
  );
  return match?.[1] ?? null;
}

function normalizeSignature(value: string | null): string {
  const raw = (value ?? "").trim();
  return raw.startsWith("sha256=") ? raw.slice("sha256=".length) : raw;
}

async function verifySignedRequest(request: Request, rawBody: string, secret: string): Promise<void> {
  const timestamp = request.headers.get("x-pkic-timestamp")?.trim() ?? "";
  const signature = normalizeSignature(request.headers.get("x-pkic-signature"));
  if (!timestamp || !signature) {
    throw new AppError(401, "INVALID_SIGNATURE", "Missing request signature headers");
  }

  const timestampInt = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(timestampInt)) {
    throw new AppError(401, "INVALID_SIGNATURE", "Invalid request timestamp");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampInt) > SIGNATURE_TOLERANCE_SECONDS) {
    throw new AppError(401, "INVALID_SIGNATURE", "Request signature has expired");
  }

  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  if (expected.length !== signature.length) {
    throw new AppError(401, "INVALID_SIGNATURE", "Invalid request signature");
  }

  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }

  if (diff !== 0) {
    throw new AppError(401, "INVALID_SIGNATURE", "Invalid request signature");
  }
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const secret = requireInternalSecret(context.env);
  const rawBody = await context.request.text();
  await verifySignedRequest(context.request, rawBody, secret);

  let payloadRaw: unknown;
  try {
    payloadRaw = JSON.parse(rawBody);
  } catch {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const parsed = internalCalendarRsvpIngestSchema.safeParse(payloadRaw);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid request body", parsed.error.flatten());
  }
  const payload = parsed.data;

  const directStatus = parseStatus(payload.partstat);
  const directSignal = payload.uid && directStatus
    ? {
      uid: payload.uid,
      status: directStatus,
      attendeeEmail: normalizeEmail(payload.attendeeEmail),
      method: payload.method?.trim() ?? null,
      sequence: payload.sequence ?? null,
    }
    : null;

  const signal = directSignal ?? parseIcsSignal(payload.calendarIcs ?? "");
  const registrationId = registrationIdFromUid(signal.uid);

  if (!registrationId) {
    return json({ success: true, ignored: true, reason: "uid_not_linked_to_registration", uid: signal.uid });
  }

  const registration = await context.env.DB.prepare("SELECT id FROM registrations WHERE id = ?")
    .bind(registrationId)
    .first<{ id: string }>();

  if (!registration) {
    return json({ success: true, ignored: true, reason: "registration_not_found", registrationId });
  }

  const now = nowIso();
  const receivedAt = payload.receivedAt ?? now;
  const attendeeEmail = signal.attendeeEmail;
  const dedupeKey = payload.sourceMessageId
    ? `${payload.provider}:msg:${payload.sourceMessageId}`
    : `${payload.provider}:uid:${signal.uid}:attendee:${attendeeEmail}:status:${signal.status}:seq:${signal.sequence ?? -1}`;
  const rawPayloadJson = JSON.stringify({
    provider: payload.provider,
    fromEmail: payload.fromEmail ?? null,
    toEmail: payload.toEmail ?? null,
    subject: payload.subject ?? null,
    sourceMessageId: payload.sourceMessageId ?? null,
    rawPayload: payload.rawPayload ?? null,
  });

  await context.env.DB.prepare(
    `INSERT INTO calendar_rsvp_events (
       id,
       registration_id,
       ics_uid,
       attendee_email,
       response_status,
       provider,
       method,
       sequence,
       source_message_id,
       dedupe_key,
       raw_payload_json,
       received_at,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(dedupe_key) DO UPDATE SET
       updated_at = excluded.updated_at,
       raw_payload_json = excluded.raw_payload_json,
       received_at = excluded.received_at,
       source_message_id = COALESCE(calendar_rsvp_events.source_message_id, excluded.source_message_id),
       method = COALESCE(excluded.method, calendar_rsvp_events.method),
       sequence = COALESCE(excluded.sequence, calendar_rsvp_events.sequence)`,
  )
    .bind(
      crypto.randomUUID(),
      registrationId,
      signal.uid,
      attendeeEmail,
      signal.status,
      payload.provider,
      signal.method,
      signal.sequence,
      payload.sourceMessageId ?? null,
      dedupeKey,
      rawPayloadJson,
      receivedAt,
      now,
      now,
    )
    .run();

  const row = await context.env.DB.prepare(
    `SELECT id
     FROM calendar_rsvp_events
     WHERE dedupe_key = ?`,
  )
    .bind(dedupeKey)
    .first<CalendarRsvpRecord>();

  return json({
    success: true,
    registrationId,
    uid: signal.uid,
    status: signal.status,
    attendeeEmail,
    rsvpEventId: row?.id ?? null,
  });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}
