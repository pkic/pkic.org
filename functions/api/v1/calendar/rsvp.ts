/** POST /api/v1/calendar/rsvp — ingest one replay-protected, signed calendar reply. */
import { AppError } from "../../../_lib/errors";
import { json } from "../../../_lib/http";
import { INTERNAL_CALENDAR_RSVP_MAX_BYTES, readBoundedTextBody } from "../../../_lib/http-body";
import { openApiRoute } from "../../../_lib/openapi/route";
import { normalizeCalendarRsvp, recordCalendarRsvpEvent } from "../../../_lib/services/calendar-rsvp";
import type { Env } from "../../../_lib/types";
import { verifyHmacSha256Hex } from "../../../_lib/utils/crypto";
import { calendarRsvpPostRouteSchema } from "../../../../assets/shared/schemas/route-contracts";

export const CALENDAR_RSVP_SIGNATURE_TOLERANCE_SECONDS = 300;

interface CalendarRsvpContext {
  env: Env;
  req: { raw: Request };
}

async function requireValidSignature(request: Request, secret: string | undefined): Promise<void> {
  if (!secret) throw new AppError(401, "INVALID_SIGNATURE", "INTERNAL_SIGNING_SECRET not configured");
  const timestamp = request.headers.get("x-pkic-timestamp");
  const signature = request.headers.get("x-pkic-signature");
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) {
    throw new AppError(401, "INVALID_SIGNATURE", "Missing or invalid signature headers");
  }
  const parsedTimestamp = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(parsedTimestamp) ||
    Math.abs(nowSeconds - parsedTimestamp) > CALENDAR_RSVP_SIGNATURE_TOLERANCE_SECONDS
  ) {
    throw new AppError(401, "INVALID_SIGNATURE", "Request signature has expired");
  }
  const body = await readBoundedTextBody(request.clone() as unknown as Request, INTERNAL_CALENDAR_RSVP_MAX_BYTES);
  if (!(await verifyHmacSha256Hex(secret, `${timestamp}.${body}`, signature))) {
    throw new AppError(401, "INVALID_SIGNATURE", "Signature verification failed");
  }
}

export const CalendarRsvpPost = openApiRoute(
  calendarRsvpPostRouteSchema,
  async (c: CalendarRsvpContext, data) => {
    await recordCalendarRsvpEvent(c.env.DB, normalizeCalendarRsvp(data.body));
    return json({ processed: 1 as const });
  },
  (c: CalendarRsvpContext) => requireValidSignature(c.req.raw, c.env.INTERNAL_SIGNING_SECRET),
);
