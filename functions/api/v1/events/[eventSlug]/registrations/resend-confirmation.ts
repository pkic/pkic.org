/**
 * POST /api/v1/events/:eventSlug/registrations/resend-confirmation
 *
 * Rotates the confirmation token and resends the confirm-email for a
 * `pending_email_confirmation` registration. Accepts either the current
 * confirmation token or an email address for stale-token recovery.
 *
 * Rate limiting / abuse prevention is handled at the edge (Cloudflare WAF) —
 * the endpoint itself enforces only that the registration is unconfirmed.
 */

import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { AppError } from "../../../../../_lib/errors";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../_lib/services/events";
import { first, run } from "../../../../../_lib/db/queries";
import { randomToken, sha256Hex } from "../../../../../_lib/utils/crypto";
import { nowIso } from "../../../../../_lib/utils/time";
import { processOutboxByIdBackground, queueEmail } from "../../../../../_lib/email/outbox";
import { getRegistrationDayAttendance } from "../../../../../_lib/services/event-days";
import { listDayWaitlistForRegistration } from "../../../../../_lib/services/registrations/day-waitlist";
import { buildAttendanceEmailData } from "../../../../../_lib/utils/attendance";
import { getAcceptedTermsTextForRegistration, getCustomAnswerRows } from "../../../../../_lib/utils/registration-email";
import { registrationConfirmPageUrl } from "../../../../../_lib/services/frontend-links";
import type { UserRecord } from "../../../../../_lib/services/users";
import type { RegistrationRecord } from "../../../../../_lib/services/registrations/types";
import { normalizedEmailSchema } from "../../../../../../assets/shared/schemas/api";

const resendConfirmationSchema = z
  .object({
    id: z.uuid().optional(),
    token: z.string().min(1).optional(),
    email: normalizedEmailSchema.optional(),
  })
  .refine((value) => Boolean(value.token || value.email), {
    message: "token or email is required",
  });

export async function onRequestPost(c: any): Promise<Response> {
  c.set("sensitive", true);

  const body = await parseJsonBody(c.req, resendConfirmationSchema);

  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  // Look up the registration by the current confirmation token first. When a
  // stale rotated token is used, the non-secret id from the link identifies
  // the pending registration so we can send a fresh token to the stored email
  // without accepting the stale token or using outbox/token history.
  const tokenHash = body.token ? await sha256Hex(body.token) : null;
  let registration = await first<RegistrationRecord>(
    c.env.DB,
    `SELECT r.*
     FROM   registrations r
     WHERE  r.confirmation_token_hash = ?
       AND  r.status = 'pending_email_confirmation'
       AND  r.event_id = ?
       AND  (? IS NULL OR r.id = ?)`,
    [tokenHash, event.id, body.id ?? null, body.id ?? null],
  );

  if (!registration && body.id && body.token) {
    registration = await first<RegistrationRecord>(
      c.env.DB,
      `SELECT r.*
       FROM   registrations r
       WHERE  r.id = ?
         AND  r.event_id = ?
         AND  r.status = 'pending_email_confirmation'
       LIMIT 1`,
      [body.id, event.id],
    );
  }

  if (!registration && body.email) {
    registration = await first<RegistrationRecord>(
      c.env.DB,
      `SELECT r.*
       FROM   registrations r
       JOIN   users u ON u.id = r.user_id
       WHERE  r.event_id = ?
         AND  r.status = 'pending_email_confirmation'
         AND  lower(u.email) = lower(?)
       ORDER BY datetime(r.created_at) DESC
       LIMIT 1`,
      [event.id, body.email],
    );
  }

  if (!registration && body.email) {
    return json({ ok: true });
  }

  if (!registration) {
    throw new AppError(
      404,
      "RESEND_TOKEN_INVALID",
      "No pending registration found for this token — it may already be confirmed.",
    );
  }

  const now = nowIso();
  const newToken = randomToken(24);
  const newTokenHash = await sha256Hex(newToken);

  await run(
    c.env.DB,
    `UPDATE registrations
     SET    confirmation_token_hash = ?,
            confirmation_token_expires_at = ?,
            confirmation_reminder_sent_at = ?,
            updated_at = ?
     WHERE  id = ?`,
    [newTokenHash, null, now, now, registration.id],
  );

  // Retrieve the attendee so we can personalise the email.
  const user = await first<UserRecord>(c.env.DB, "SELECT * FROM users WHERE id = ?", [registration.user_id]);
  if (!user) {
    throw new AppError(500, "USER_NOT_FOUND", "Associated user record is missing");
  }

  // manage_token_hash is a one-way hash so we cannot reconstruct the URL here.
  // Fall back to the generic event manage page — the attendee can look up their
  // registration by email there.
  const manageUrl = `${appBaseUrl}/events/${event.slug}/manage`;

  const confirmationUrl = registrationConfirmPageUrl(appBaseUrl, event, newToken, registration.id);
  const dayAttendanceRaw = await getRegistrationDayAttendance(c.env.DB, registration.id);
  const dayWaitlist = await listDayWaitlistForRegistration(c.env.DB, registration.id);
  const { attendanceLabel, dayAttendance } = buildAttendanceEmailData(
    registration.attendance_type,
    dayAttendanceRaw,
    dayWaitlist,
  );
  const customAnswerRows = await getCustomAnswerRows(c.env.DB, event.id, registration.custom_answers_json);
  const acceptedTermsText = await getAcceptedTermsTextForRegistration(c.env.DB, registration.id);

  const outboxId = await queueEmail(c.env.DB, {
    eventId: event.id,
    baseUrl: appBaseUrl,
    templateKey: "registration_confirm_email",
    recipientEmail: user.email,
    recipientUserId: user.id,
    messageType: "transactional",
    subject: `Confirm your registration for ${event.name}`,
    data: {
      ...buildEventEmailVariables(event, appBaseUrl),
      // User
      firstName: user.first_name ?? "",
      lastName: user.last_name ?? "",
      email: user.email,
      organizationName: user.organization_name ?? "",
      jobTitle: user.job_title ?? "",
      // Registration
      attendanceLabel,
      dayAttendance,
      customAnswerRows,
      acceptedTermsText: acceptedTermsText || undefined,
      dayWaitlist,
      status: registration.status,
      registrationId: registration.id,
      // URLs
      confirmationUrl,
      manageUrl,
      shareUrl: null,
    },
  });

  c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outboxId));

  return json({ ok: true });
}

export class EventsEventSlugRegistrationsResendConfirmationPost extends OpenAPIRoute {
  schema = {};

  async handle(c: any) {
    return onRequestPost(c);
  }
}
