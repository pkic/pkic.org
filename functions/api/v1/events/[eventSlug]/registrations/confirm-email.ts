import { parseJsonBody } from "../../../../../_lib/validation";
import { json, markSensitive } from "../../../../../_lib/http";
import { getConfig, resolveAppBaseUrl } from "../../../../../_lib/config";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../_lib/services/events";
import { confirmRegistrationByToken } from "../../../../../_lib/services/registrations";
import { getRegistrationDayAttendance } from "../../../../../_lib/services/event-days";
import { buildAttendanceEmailData } from "../../../../../_lib/utils/attendance";
import { getAcceptedTermsTextForRegistration, getCustomAnswerRows } from "../../../../../_lib/utils/registration-email";
import { first } from "../../../../../_lib/db/queries";
import { processOutboxByIdBackground, queueEmail } from "../../../../../_lib/email/outbox";
import { buildRegistrationIcs } from "../../../../../_lib/utils/calendar";
import { registrationManagePageUrl } from "../../../../../_lib/services/frontend-links";
import type { UserRecord } from "../../../../../_lib/services/users";
import type { PagesContext } from "../../../../../_lib/types";
import { registrationConfirmSchema } from "../../../../../../shared/schemas/api";

async function confirmRegistration(
  context: PagesContext<{ eventSlug: string }>,
  token: string,
): Promise<Response> {
  const config = getConfig(context.env, context.request);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);
  const appBaseUrl = resolveAppBaseUrl(context.env, context.request);

  const { registration, manageToken } = await confirmRegistrationByToken(context.env.DB, {
    token,
    eventCapacity: event.capacity_in_person,
    waitlistClaimWindowHours: config.waitlistClaimWindowHours,
  });

  // Look up the attendee's referral (share) code so the confirmation page can
  // present it as a sharing prompt — the Peak-End moment for engagement.
  const referralRow = await first<{ code: string }>(
    context.env.DB,
    "SELECT code FROM referral_codes WHERE owner_type = 'registration' AND owner_id = ? LIMIT 1",
    [registration.id],
  );
  const shareUrl = referralRow ? `${appBaseUrl}/r/${referralRow.code}` : null;
  const manageUrl = registrationManagePageUrl(appBaseUrl, event, manageToken);

  const user = await first<UserRecord>(context.env.DB, "SELECT * FROM users WHERE id = ?", [registration.user_id]);
  if (user) {
    if (registration.status === "registered" || registration.status === "waitlisted") {
      const dayAttendanceRaw = await getRegistrationDayAttendance(context.env.DB, registration.id);
      const { attendanceLabel, dayAttendance } = buildAttendanceEmailData(
        registration.attendance_type,
        dayAttendanceRaw,
      );
      const customAnswerRows = await getCustomAnswerRows(context.env.DB, event.id, registration.custom_answers_json);
      const acceptedTermsText = await getAcceptedTermsTextForRegistration(context.env.DB, registration.id);
      const calendar = buildRegistrationIcs(event, registration.id, manageUrl, dayAttendanceRaw, appBaseUrl);
      const outboxId = await queueEmail(context.env.DB, {
        eventId: event.id,
        templateKey: "registration_confirmed",
        recipientEmail: user.email,
        recipientUserId: registration.user_id,
        messageType: "transactional",
        subject: `Registration confirmed for ${event.name}`,
        data: {
          ...buildEventEmailVariables(event, appBaseUrl),
          // User
          firstName: user.first_name ?? "",
          lastName: user.last_name ?? "",
          email: user.email,
          organizationName: user.organization_name ?? "",
          jobTitle: user.job_title ?? "",
          // Registration
          attendanceType: registration.attendance_type,
          attendanceLabel,
          dayAttendance,
          customAnswerRows,
          acceptedTermsText: acceptedTermsText || undefined,
          status: registration.status,
          registrationId: registration.id,
          // URLs
          manageUrl,
          shareUrl,
          ...(referralRow ? {
            __badgeCode: referralRow.code,
            badgeImageUrl: `${appBaseUrl}/api/v1/og/${referralRow.code}`,
            linkedinShareUrl: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl as string)}`,
            twitterShareUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`I just registered for ${event.name} — join me! ${shareUrl}`)}`,
            blueskyShareUrl: `https://bsky.app/intent/compose?text=${encodeURIComponent(`I just registered for ${event.name} — join me!\n${shareUrl}`)}`,
            redditShareUrl: `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl as string)}&title=${encodeURIComponent(`Join me at ${event.name}`)}`,
          } : {}),
        },
        calendar: {
          registrationId: registration.id,
          eventId: event.id,
          icsUid: calendar.uid,
          icsContent: calendar.content,
        },
      });
      context.waitUntil(processOutboxByIdBackground(context.env.DB, context.env, outboxId));
    }
  }

  return json({ success: true, status: registration.status, shareUrl, manageUrl, manageToken });
}

export async function onRequestPost(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  const body = await parseJsonBody(context.request, registrationConfirmSchema);
  return confirmRegistration(context, body.token);
}

export async function onRequestGet(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  const token = new URL(context.request.url).searchParams.get("token");
  if (!token) {
    return json({ error: { code: "TOKEN_REQUIRED", message: "token query parameter is required" } }, 400);
  }

  const parsed = registrationConfirmSchema.safeParse({ token });
  if (!parsed.success) {
    return json({ error: { code: "VALIDATION_ERROR", message: "Invalid token" } }, 400);
  }

  return confirmRegistration(context, parsed.data.token);
}

export async function onRequest(context: PagesContext<{ eventSlug: string }>): Promise<Response> {
  markSensitive(context);
  if (context.request.method === "POST") {
    return onRequestPost(context);
  }

  if (context.request.method === "GET") {
    return onRequestGet(context);
  }

  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
