/**
 * POST /api/v1/events/:eventSlug/registrations/resend-confirmation
 *
 * Rotates the confirmation token and resends the confirm-email for a
 * `pending_email_confirmation` registration. Accepts either an expired or a
 * still-valid confirmation token so the confirm page can always offer a
 * "send me a new link" action.
 *
 * Rate limiting / abuse prevention is handled at the edge (Cloudflare WAF) —
 * the endpoint itself enforces only that the registration is unconfirmed.
 */

import { z } from "zod";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json, markSensitive } from "../../../../../_lib/http";
import { AppError } from "../../../../../_lib/errors";
import { getConfig, resolveAppBaseUrl } from "../../../../../_lib/config";
import { getEventBySlug, resolveHeroImageUrl, resolveSponsorsImageUrl } from "../../../../../_lib/services/events";
import { first, run } from "../../../../../_lib/db/queries";
import { randomToken, sha256Hex } from "../../../../../_lib/utils/crypto";
import { nowIso, addHours } from "../../../../../_lib/utils/time";
import { processOutboxByIdBackground, queueEmail } from "../../../../../_lib/email/outbox";
import { getRegistrationDayAttendance } from "../../../../../_lib/services/event-days";
import { buildAttendanceEmailData } from "../../../../../_lib/utils/attendance";
import { getAcceptedTermsTextForRegistration, getCustomAnswerRows } from "../../../../../_lib/utils/registration-email";
import { registrationConfirmPageUrl } from "../../../../../_lib/services/frontend-links";
import type { UserRecord } from "../../../../../_lib/services/users";
import type { RegistrationRecord } from "../../../../../_lib/services/registrations/types";
import type { PagesContext } from "../../../../../_lib/types";

const resendConfirmationSchema = z.object({
  token: z.string().min(1),
});

export async function onRequestPost(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  markSensitive(context);

  const config = getConfig(context.env, context.request);
  const body = await parseJsonBody(context.request, resendConfirmationSchema);

  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);
  const appBaseUrl = resolveAppBaseUrl(context.env, context.request);

  // Look up the registration by the (possibly-expired) confirmation token.
  // The token hash is cleared when confirmed, so a used token naturally returns 404.
  const tokenHash = await sha256Hex(body.token);
  const registration = await first<RegistrationRecord>(
    context.env.DB,
    `SELECT r.*
     FROM   registrations r
     WHERE  r.confirmation_token_hash = ?
       AND  r.status = 'pending_email_confirmation'
       AND  r.event_id = ?`,
    [tokenHash, event.id],
  );

  if (!registration) {
    throw new AppError(
      404,
      "RESEND_TOKEN_INVALID",
      "No pending registration found for this token — it may already be confirmed.",
    );
  }

  // Rotate the confirmation token so the old (possibly-shared or phished) link
  // is immediately invalidated.
  const now = nowIso();
  const newToken = randomToken(24);
  const newTokenHash = await sha256Hex(newToken);
  const newExpiresAt = addHours(now, config.manageTokenTtlHours);

  await run(
    context.env.DB,
    `UPDATE registrations
     SET    confirmation_token_hash = ?,
            confirmation_token_expires_at = ?,
            updated_at = ?
     WHERE  id = ?`,
    [newTokenHash, newExpiresAt, now, registration.id],
  );

  // Retrieve the attendee so we can personalise the email.
  const user = await first<UserRecord>(
    context.env.DB,
    "SELECT * FROM users WHERE id = ?",
    [registration.user_id],
  );
  if (!user) {
    throw new AppError(500, "USER_NOT_FOUND", "Associated user record is missing");
  }

  // manage_token_hash is a one-way hash so we cannot reconstruct the URL here.
  // Fall back to the generic event manage page — the attendee can look up their
  // registration by email there.
  const manageUrl = `${appBaseUrl}/events/${event.slug}/manage`;

  const confirmationUrl = registrationConfirmPageUrl(appBaseUrl, event, newToken);
  const dayAttendanceRaw = await getRegistrationDayAttendance(context.env.DB, registration.id);
  const { attendanceLabel, dayAttendance } = buildAttendanceEmailData(
    registration.attendance_type,
    dayAttendanceRaw,
  );
  const customAnswerRows = await getCustomAnswerRows(context.env.DB, event.id, registration.custom_answers_json);
  const acceptedTermsText = await getAcceptedTermsTextForRegistration(context.env.DB, registration.id);

  const outboxId = await queueEmail(context.env.DB, {
    eventId: event.id,
    templateKey: "registration_confirm_email",
    recipientEmail: user.email,
    recipientUserId: user.id,
    messageType: "transactional",
    subject: `Confirm your registration for ${event.name}`,
    data: {
      // Event
      eventName: event.name,
      eventSlug: event.slug,
      eventTimezone: event.timezone,
      eventStartsAt: event.starts_at ?? "",
      eventEndsAt: event.ends_at ?? "",
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
      status: registration.status,
      registrationId: registration.id,
      // URLs
      confirmationUrl,
      manageUrl,
      shareUrl: null,
      // Media
      sponsorsImageUrl: resolveSponsorsImageUrl(event),
      heroImageUrl: resolveHeroImageUrl(event),
    },
  });

  context.waitUntil(processOutboxByIdBackground(context.env.DB, context.env, outboxId));

  return json({ ok: true });
}
