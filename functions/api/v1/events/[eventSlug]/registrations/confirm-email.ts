import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../_lib/validation";
import { handleError, json } from "../../../../../_lib/http";
import { getConfig, resolveAppBaseUrl } from "../../../../../_lib/config";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../_lib/services/events";
import { confirmRegistrationByToken } from "../../../../../_lib/services/registrations";
import { getRegistrationDayAttendance } from "../../../../../_lib/services/event-days";
import { listDayWaitlistForRegistration } from "../../../../../_lib/services/registrations/day-waitlist";
import { buildAttendanceEmailData } from "../../../../../_lib/utils/attendance";
import { getAcceptedTermsTextForRegistration, getCustomAnswerRows } from "../../../../../_lib/utils/registration-email";
import { first } from "../../../../../_lib/db/queries";
import { buildBadgeAttachment } from "../../../../../_lib/email/attachments";
import { processOutboxByIdBackground, queueEmail } from "../../../../../_lib/email/outbox";
import { buildRegistrationIcs } from "../../../../../_lib/utils/calendar";
import { generateSignedRsvpAddress } from "../../../../../_lib/email/rsvp";
import { registrationManagePageUrl } from "../../../../../_lib/services/frontend-links";
import type { UserRecord } from "../../../../../_lib/services/users";
import { registrationConfirmSchema } from "../../../../../../assets/shared/schemas/api";

async function confirmRegistration(
  c: any,
  token: string,
): Promise<Response> {
  const config = getConfig(c.env, c.req.raw);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  const { registration, manageToken } = await confirmRegistrationByToken(c.env.DB, {
    token,
    waitlistClaimWindowHours: config.waitlistClaimWindowHours,
  });

  // Look up the attendee's referral (share) code so the confirmation page can
  // present it as a sharing prompt — the Peak-End moment for engagement.
  const referralRow = await first<{ code: string }>(
    c.env.DB,
    "SELECT code FROM referral_codes WHERE owner_type = 'registration' AND owner_id = ? LIMIT 1",
    [registration.id],
  );
  const shareUrl = referralRow ? `${appBaseUrl}/r/${referralRow.code}` : null;
  const manageUrl = registrationManagePageUrl(appBaseUrl, event, manageToken);
  const dayAttendanceRaw = await getRegistrationDayAttendance(c.env.DB, registration.id);
  const dayWaitlist = await listDayWaitlistForRegistration(c.env.DB, registration.id);

  const user = await first<UserRecord>(c.env.DB, "SELECT * FROM users WHERE id = ?", [registration.user_id]);
  if (user) {
    if (registration.status === "registered" || registration.status === "waitlisted") {
      const { attendanceLabel, dayAttendance } = buildAttendanceEmailData(
        registration.attendance_type,
        dayAttendanceRaw,
        dayWaitlist,
      );
      const customAnswerRows = await getCustomAnswerRows(c.env.DB, event.id, registration.custom_answers_json);
      const acceptedTermsText = await getAcceptedTermsTextForRegistration(c.env.DB, registration.id);
      const rsvpEmail = c.env.INTERNAL_SIGNING_SECRET ? await generateSignedRsvpAddress(registration.id, c.env.INTERNAL_SIGNING_SECRET, c.env.RSVP_EMAIL) : undefined;
      const calendar = buildRegistrationIcs(event, registration.id, manageUrl, dayAttendanceRaw, appBaseUrl, rsvpEmail, user.email);
      const outboxId = await queueEmail(c.env.DB, {
        eventId: event.id,
        baseUrl: appBaseUrl,
        templateKey: "registration_confirmed",
        recipientEmail: user.email,
        recipientUserId: registration.user_id,
        messageType: "transactional",
        subject: `Registration confirmed for ${event.name}`,
        attachments: referralRow ? [
          buildBadgeAttachment({
            badgeCode: referralRow.code,
            badgeType: "attendee",
            firstName: user.first_name ?? "",
            lastName: user.last_name ?? "",
          }),
        ] : undefined,
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
          dayWaitlist,
          customAnswerRows,
          acceptedTermsText: acceptedTermsText || undefined,
          status: registration.status,
          registrationId: registration.id,
          // URLs
          manageUrl,
          shareUrl,
          ...(referralRow ? {
            badgeImageUrl: `${appBaseUrl}/api/v1/og/${referralRow.code}`,
            linkedinShareUrl: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl as string)}`,
            twitterShareUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`I just registered for ${event.name} — join me! ${shareUrl}`)}`,
            blueskyShareUrl: `https://bsky.app/intent/compose?text=${encodeURIComponent(`I just registered for ${event.name} — join me!\n${shareUrl}`)}`,
            redditShareUrl: `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl as string)}&title=${encodeURIComponent(`Join me at ${event.name}`)}`,
          } : {}),
        },
        bounceAddress: rsvpEmail,
        calendar: {
          registrationId: registration.id,
          eventId: event.id,
          icsUid: calendar.uid,
          icsContent: calendar.content,
        },
      });
      c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outboxId));
    }
  }

  return json({
    success: true,
    status: registration.status,
    shareUrl,
    manageUrl,
    manageToken,
    dayAttendance: dayAttendanceRaw,
    dayWaitlist,
  });
}

export async function onRequestPost(c: any): Promise<Response> {
  const body = await parseJsonBody(c.req, registrationConfirmSchema);
  return confirmRegistration(c, body.token);
}

export async function onRequestGet(c: any): Promise<Response> {
  const token = new URL(c.req.raw.url).searchParams.get("token");
  if (!token) {
    return json({ error: { code: "TOKEN_REQUIRED", message: "token query parameter is required" } }, 400);
  }

  const parsed = registrationConfirmSchema.safeParse({ token });
  if (!parsed.success) {
    return json({ error: { code: "VALIDATION_ERROR", message: "Invalid token" } }, 400);
  }

  return confirmRegistration(c, parsed.data.token);
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method === "GET") {
    return onRequestGet(c);
  }
  if (c.req.raw.method === "POST") {
    return onRequestPost(c);
  }
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}

export class EventsEventSlugRegistrationsConfirmEmailGet extends OpenAPIRoute {
  schema = {};

  async handle(c: any) {
    try {
      return await onRequestGet(c);
    } catch (error) {
      return handleError(error);
    }
  }
}

export class EventsEventSlugRegistrationsConfirmEmailPost extends OpenAPIRoute {
  schema = {};

  async handle(c: any) {
    try {
      return await onRequestPost(c);
    } catch (error) {
      return handleError(error);
    }
  }
}
