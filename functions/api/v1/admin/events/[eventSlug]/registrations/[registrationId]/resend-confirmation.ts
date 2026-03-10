/**
 * POST /api/v1/admin/events/:eventSlug/registrations/:registrationId/resend-confirmation
 *
 * Resends the registration email to the registrant.
 *  - pending_email_confirmation → rotates confirmation token, sends confirm-email
 *  - registered / waitlisted    → rotates manage token, resends registration-confirmed email
 */
import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { getEventBySlug, resolveEventVenue, resolveHeroImageUrl, resolveSponsorsImageUrl } from "../../../../../../../_lib/services/events";
import { first, run } from "../../../../../../../_lib/db/queries";
import { randomToken, sha256Hex } from "../../../../../../../_lib/utils/crypto";
import { nowIso, addHours } from "../../../../../../../_lib/utils/time";
import { getConfig, resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { processOutboxByIdBackground, queueEmail } from "../../../../../../../_lib/email/outbox";
import { getRegistrationDayAttendance } from "../../../../../../../_lib/services/event-days";
import { buildAttendanceEmailData } from "../../../../../../../_lib/utils/attendance";
import { getAcceptedTermsTextForRegistration, getCustomAnswerRows } from "../../../../../../../_lib/utils/registration-email";
import { registrationConfirmPageUrl, registrationManagePageUrl } from "../../../../../../../_lib/services/frontend-links";
import { buildRegistrationIcs } from "../../../../../../../_lib/utils/calendar";
import { writeAuditLog } from "../../../../../../../_lib/services/audit";
import type { RegistrationRecord } from "../../../../../../../_lib/services/registrations/types";
import type { UserRecord } from "../../../../../../../_lib/services/users";
import type { PagesContext } from "../../../../../../../_lib/types";

export async function onRequestPost(
  context: PagesContext<{ eventSlug: string; registrationId: string }>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const config = getConfig(context.env, context.request);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);
  const appBaseUrl = resolveAppBaseUrl(context.env, context.request);

  const registration = await first<RegistrationRecord>(
    context.env.DB,
    "SELECT * FROM registrations WHERE id = ? AND event_id = ?",
    [context.params.registrationId, event.id],
  );
  if (!registration) {
    return json({ error: { code: "REGISTRATION_NOT_FOUND", message: "Registration not found" } }, 404);
  }

  if (registration.status === "cancelled") {
    return json({ error: { code: "REGISTRATION_CANCELLED", message: "Cannot resend email to a cancelled registration" } }, 409);
  }

  const user = await first<UserRecord>(
    context.env.DB,
    "SELECT * FROM users WHERE id = ?",
    [registration.user_id],
  );
  if (!user) {
    return json({ error: { code: "USER_NOT_FOUND", message: "Associated user not found" } }, 500);
  }

  const dayAttendanceRaw = await getRegistrationDayAttendance(context.env.DB, registration.id);
  const { attendanceLabel, dayAttendance } = buildAttendanceEmailData(registration.attendance_type, dayAttendanceRaw);
  const customAnswerRows = await getCustomAnswerRows(context.env.DB, event.id, registration.custom_answers_json);
  const acceptedTermsText = await getAcceptedTermsTextForRegistration(context.env.DB, registration.id);

  // Look up referral code for share URL
  const referralRow = await first<{ code: string }>(
    context.env.DB,
    "SELECT code FROM referral_codes WHERE owner_type = 'registration' AND owner_id = ?",
    [registration.id],
  );
  const shareUrl = referralRow ? `${appBaseUrl}/r/${referralRow.code}` : null;

  let outboxId: string;
  const now = nowIso();

  if (registration.status === "pending_email_confirmation") {
    // Rotate confirmation token and resend the confirm-email
    const newToken = randomToken(24);
    const newTokenHash = await sha256Hex(newToken);
    const newExpiresAt = addHours(now, config.manageTokenTtlHours);

    await run(
      context.env.DB,
      `UPDATE registrations
       SET confirmation_token_hash = ?, confirmation_token_expires_at = ?, updated_at = ?
       WHERE id = ?`,
      [newTokenHash, newExpiresAt, now, registration.id],
    );

    const confirmationUrl = registrationConfirmPageUrl(appBaseUrl, event, newToken);

    outboxId = await queueEmail(context.env.DB, {
      eventId: event.id,
      templateKey: "registration_confirm_email",
      recipientEmail: user.email,
      recipientUserId: user.id,
      messageType: "transactional",
      subject: `Confirm your registration for ${event.name}`,
      data: {
        eventName: event.name,
        eventSlug: event.slug,
        eventTimezone: event.timezone,
        eventStartsAt: event.starts_at ?? "",
        eventEndsAt: event.ends_at ?? "",
        firstName: user.first_name ?? "",
        lastName: user.last_name ?? "",
        email: user.email,
        organizationName: user.organization_name ?? "",
        jobTitle: user.job_title ?? "",
        attendanceLabel,
        dayAttendance,
        customAnswerRows,
        acceptedTermsText: acceptedTermsText || undefined,
        status: registration.status,
        registrationId: registration.id,
        confirmationUrl,
        manageUrl: "",
        shareUrl,
        sponsorsImageUrl: resolveSponsorsImageUrl(event),
        heroImageUrl: resolveHeroImageUrl(event),
      },
    });
  } else {
    // Rotate manage token and resend registration-confirmed email
    const freshManageToken = randomToken(24);
    const freshManageHash = await sha256Hex(freshManageToken);

    await run(
      context.env.DB,
      "UPDATE registrations SET manage_token_hash = ?, updated_at = ? WHERE id = ?",
      [freshManageHash, now, registration.id],
    );

    const manageUrl = registrationManagePageUrl(appBaseUrl, event, freshManageToken);
    const calendar = buildRegistrationIcs(event, registration.id, manageUrl, dayAttendanceRaw, appBaseUrl);

    outboxId = await queueEmail(context.env.DB, {
      eventId: event.id,
      templateKey: "registration_confirmed",
      recipientEmail: user.email,
      recipientUserId: user.id,
      messageType: "transactional",
      subject: `Registration confirmed for ${event.name}`,
      data: {
        eventName: event.name,
        eventSlug: event.slug,
        eventTimezone: event.timezone,
        eventStartsAt: event.starts_at ?? "",
        eventEndsAt: event.ends_at ?? "",
        eventUrl: event.base_path ? `${appBaseUrl}${event.base_path}` : null,
        venue: resolveEventVenue(event),
        firstName: user.first_name ?? "",
        lastName: user.last_name ?? "",
        email: user.email,
        organizationName: user.organization_name ?? "",
        jobTitle: user.job_title ?? "",
        attendanceType: registration.attendance_type,
        attendanceLabel,
        dayAttendance,
        customAnswerRows,
        acceptedTermsText: acceptedTermsText || undefined,
        status: registration.status,
        registrationId: registration.id,
        manageUrl,
        shareUrl,
        ...(referralRow ? {
          __badgeCode: referralRow.code,
          badgeImageUrl: `${appBaseUrl}/api/v1/og/${referralRow.code}`,
          linkedinShareUrl: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`${appBaseUrl}/r/${referralRow.code}`)}`,
          twitterShareUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`I just registered for ${event.name} — join me! ${appBaseUrl}/r/${referralRow.code}`)}`,
          blueskyShareUrl: `https://bsky.app/intent/compose?text=${encodeURIComponent(`I just registered for ${event.name} — join me!\n${appBaseUrl}/r/${referralRow.code}`)}`,
          redditShareUrl: `https://www.reddit.com/submit?url=${encodeURIComponent(`${appBaseUrl}/r/${referralRow.code}`)}&title=${encodeURIComponent(`Join me at ${event.name}`)}`,
        } : {}),
        sponsorsImageUrl: resolveSponsorsImageUrl(event),
        heroImageUrl: resolveHeroImageUrl(event),
      },
      calendar: {
        registrationId: registration.id,
        eventId: event.id,
        icsUid: calendar.uid,
        icsContent: calendar.content,
      },
    });
  }

  context.waitUntil(processOutboxByIdBackground(context.env.DB, context.env, outboxId));

  await writeAuditLog(
    context.env.DB,
    "admin",
    admin.id,
    "admin_registration_email_resent",
    "registration",
    registration.id,
    { eventId: event.id, recipientEmail: user.email, status: registration.status },
  );

  return json({ success: true, message: "Email queued" });
}

export async function onRequest(
  context: PagesContext<{ eventSlug: string; registrationId: string }>,
): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}
