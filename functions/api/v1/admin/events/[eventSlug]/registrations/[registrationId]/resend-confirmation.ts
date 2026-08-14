/**
 * POST /api/v1/admin/events/:eventSlug/registrations/:registrationId/resend-confirmation
 *
 * Resends the registration email to the registrant.
 *  - pending_email_confirmation → sends a fresh expiring confirmation link
 *  - registered                 → sends a fresh expiring management link
 */
import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../../../_lib/services/events";
import { first, run } from "../../../../../../../_lib/db/queries";
import { nowIso } from "../../../../../../../_lib/utils/time";
import { getConfig, resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { buildBadgeAttachment } from "../../../../../../../_lib/email/attachments";
import { processOutboxByIdBackground, queueEmail } from "../../../../../../../_lib/email/outbox";
import { getRegistrationDayAttendance } from "../../../../../../../_lib/services/event-days";
import { listDayWaitlistForRegistration } from "../../../../../../../_lib/services/registrations/day-waitlist";
import { buildAttendanceEmailData, buildRegistrationEmailStatusData } from "../../../../../../../_lib/utils/attendance";
import {
  getAcceptedTermsTextForRegistration,
  getCustomAnswerRows,
} from "../../../../../../../_lib/utils/registration-email";
import {
  registrationConfirmPageUrl,
  registrationManagePageUrl,
} from "../../../../../../../_lib/services/frontend-links";
import { buildRegistrationIcs } from "../../../../../../../_lib/utils/calendar";
import { generateSignedRsvpAddress } from "../../../../../../../_lib/email/rsvp";
import { writeAuditLog } from "../../../../../../../_lib/services/audit";
import type { RegistrationRecord } from "../../../../../../../_lib/services/registrations/types";
import type { UserRecord } from "../../../../../../../_lib/services/users";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { queuedCapabilityToken } from "../../../../../../../_lib/services/capability-links";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const config = getConfig(c.env, c.req.raw);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const registrationId = c.req.param("registrationId");

  const registration = await first<RegistrationRecord>(
    requestDb(c),
    "SELECT * FROM registrations WHERE id = ? AND event_id = ?",
    [registrationId, event.id],
  );
  if (!registration) {
    return json({ error: { code: "REGISTRATION_NOT_FOUND", message: "Registration not found" } }, 404);
  }

  if (registration.status === "cancelled") {
    return json(
      { error: { code: "REGISTRATION_CANCELLED", message: "Cannot resend email to a cancelled registration" } },
      409,
    );
  }

  const user = await first<UserRecord>(requestDb(c), "SELECT * FROM users WHERE id = ?", [registration.user_id]);
  if (!user) {
    return json({ error: { code: "USER_NOT_FOUND", message: "Associated user not found" } }, 500);
  }

  const dayAttendanceRaw = await getRegistrationDayAttendance(requestDb(c), registration.id);
  const dayWaitlist = await listDayWaitlistForRegistration(requestDb(c), registration.id);
  const attendanceData = buildAttendanceEmailData(registration.attendance_type, dayAttendanceRaw, dayWaitlist);
  const statusData = buildRegistrationEmailStatusData(registration.status, dayWaitlist);
  const customAnswerRows = await getCustomAnswerRows(requestDb(c), event.id, registration.custom_answers_json);
  const acceptedTermsText = await getAcceptedTermsTextForRegistration(requestDb(c), registration.id);

  // Look up referral code for share URL
  const referralRow = await first<{ code: string }>(
    requestDb(c),
    "SELECT code FROM referral_codes WHERE owner_type = 'registration' AND owner_id = ?",
    [registration.id],
  );
  const shareUrl = referralRow ? `${appBaseUrl}/r/${referralRow.code}` : null;

  let outboxId: string;
  const now = nowIso();

  if (registration.status === "pending_email_confirmation") {
    await run(
      requestDb(c),
      `UPDATE registrations
       SET confirmation_reminder_sent_at = ?, updated_at = ?
       WHERE id = ?`,
      [now, now, registration.id],
    );

    const confirmationUrl = registrationConfirmPageUrl(
      appBaseUrl,
      event,
      queuedCapabilityToken("registration_confirm", registration.id, config.confirmationLinkTtlHours * 60 * 60),
      registration.id,
    );

    outboxId = await queueEmail(requestDb(c), {
      eventId: event.id,
      baseUrl: appBaseUrl,
      templateKey: "registration_confirm_email",
      recipientEmail: user.email,
      recipientUserId: user.id,
      messageType: "transactional",
      subject: `Confirm your registration for ${event.name}`,
      capabilityLinkValues: [confirmationUrl],
      data: {
        ...buildEventEmailVariables(event, appBaseUrl),
        firstName: user.first_name ?? "",
        lastName: user.last_name ?? "",
        email: user.email,
        organizationName: user.organization_name ?? "",
        jobTitle: user.job_title ?? "",
        attendanceLabel: attendanceData.attendanceLabel,
        dayAttendance: attendanceData.dayAttendance,
        customAnswerRows,
        dayWaitlist,
        acceptedTermsText: acceptedTermsText || undefined,
        ...statusData,
        registrationId: registration.id,
        confirmationUrl,
        manageUrl: "",
        shareUrl,
      },
    });
  } else {
    const manageUrl = registrationManagePageUrl(
      appBaseUrl,
      event,
      queuedCapabilityToken("registration_manage", registration.id),
    );
    const rsvpEmail = c.env.INTERNAL_SIGNING_SECRET
      ? await generateSignedRsvpAddress(registration.id, c.env.INTERNAL_SIGNING_SECRET, c.env.RSVP_EMAIL)
      : undefined;
    const calendar = await buildRegistrationIcs(
      event,
      registration.id,
      manageUrl,
      dayAttendanceRaw,
      appBaseUrl,
      rsvpEmail,
      user.email,
      c.env.INTERNAL_SIGNING_SECRET,
    );

    outboxId = await queueEmail(requestDb(c), {
      eventId: event.id,
      baseUrl: appBaseUrl,
      templateKey: "registration_confirmed",
      recipientEmail: user.email,
      recipientUserId: user.id,
      messageType: "transactional",
      subject: `Registration confirmed for ${event.name}`,
      capabilityLinkValues: [manageUrl],
      attachments: referralRow
        ? [
            buildBadgeAttachment({
              badgeCode: referralRow.code,
              badgeType: "attendee",
              firstName: user.first_name ?? "",
              lastName: user.last_name ?? "",
            }),
          ]
        : undefined,
      data: {
        ...buildEventEmailVariables(event, appBaseUrl),
        firstName: user.first_name ?? "",
        lastName: user.last_name ?? "",
        email: user.email,
        organizationName: user.organization_name ?? "",
        jobTitle: user.job_title ?? "",
        attendanceType: registration.attendance_type,
        attendanceLabel: attendanceData.attendanceLabel,
        dayAttendance: attendanceData.dayAttendance,
        customAnswerRows,
        dayWaitlist,
        acceptedTermsText: acceptedTermsText || undefined,
        ...statusData,
        registrationId: registration.id,
        manageUrl,
        shareUrl,
        ...(referralRow
          ? {
              badgeImageUrl: `${appBaseUrl}/api/v1/og/${referralRow.code}`,
              linkedinShareUrl: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`${appBaseUrl}/r/${referralRow.code}`)}`,
              twitterShareUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`I just registered for ${event.name} — join me! ${appBaseUrl}/r/${referralRow.code}`)}`,
              blueskyShareUrl: `https://bsky.app/intent/compose?text=${encodeURIComponent(`I just registered for ${event.name} — join me!\n${appBaseUrl}/r/${referralRow.code}`)}`,
              redditShareUrl: `https://www.reddit.com/submit?url=${encodeURIComponent(`${appBaseUrl}/r/${referralRow.code}`)}&title=${encodeURIComponent(`Join me at ${event.name}`)}`,
            }
          : {}),
      },
      bounceAddress: rsvpEmail,
      calendar: {
        registrationId: registration.id,
        eventId: event.id,
        icsUid: calendar.uid,
        icsFiles: calendar.files,
        inlineContent: calendar.inlineContent,
      },
    });
  }

  c.executionCtx.waitUntil(processOutboxByIdBackground(requestDb(c), c.env, outboxId));

  await writeAuditLog(
    requestDb(c),
    "admin",
    admin.id,
    "admin_registration_email_resent",
    "registration",
    registration.id,
    {
      eventId: event.id,
      recipientEmail: user.email,
      status: registration.status,
    },
  );

  return json({ success: true, message: "Email queued" });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
