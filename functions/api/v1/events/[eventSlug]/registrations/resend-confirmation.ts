/**
 * POST /api/v1/events/:eventSlug/registrations/resend-confirmation
 *
 * Resends the confirm-email for a `pending_email_confirmation` registration.
 * Accepts either the current confirmation link or an email address for link
 * recovery. Resending does not invalidate other unexpired links.
 *
 * The endpoint applies the same per-email and per-IP recovery limits as the
 * other public link-recovery routes.
 */

import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { AppError } from "../../../../../_lib/errors";
import { getConfig, resolveAppBaseUrl } from "../../../../../_lib/config";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../_lib/services/events";
import { first, run } from "../../../../../_lib/db/queries";
import { nowIso } from "../../../../../_lib/utils/time";
import { processOutboxByIdBackground, queueEmail } from "../../../../../_lib/email/outbox";
import { getRegistrationDayAttendance } from "../../../../../_lib/services/event-days";
import { listDayWaitlistForRegistration } from "../../../../../_lib/services/registrations/day-waitlist";
import { buildAttendanceEmailData, buildRegistrationEmailStatusData } from "../../../../../_lib/utils/attendance";
import { getAcceptedTermsTextForRegistration, getCustomAnswerRows } from "../../../../../_lib/utils/registration-email";
import { registrationConfirmPageUrl } from "../../../../../_lib/services/frontend-links";
import type { UserRecord } from "../../../../../_lib/services/users";
import type { RegistrationRecord } from "../../../../../_lib/services/registrations/types";
import { registrationResendConfirmationSchema } from "../../../../../../assets/shared/schemas/api";
import { registrationResendConfirmationRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import { queuedCapabilityToken, verifyDatabaseCapability } from "../../../../../_lib/services/capability-links";
import { getClientIp, requireInternalSecret } from "../../../../../_lib/request";
import { enforceRateLimit } from "../../../../../_lib/rate-limit";

export async function onRequestPost(c: any): Promise<Response> {
  c.set("sensitive", true);

  const body = await parseJsonBody(c.req, registrationResendConfirmationSchema);
  if (body.email) {
    await enforceRateLimit({
      binding: c.env.EMAIL_RATE_LIMITER,
      namespace: "registration-resend-confirmation:email",
      key: body.email,
    });
  }
  await enforceRateLimit({
    binding: c.env.IP_RATE_LIMITER,
    namespace: "registration-resend-confirmation:ip",
    key: getClientIp(c.req.raw),
  });

  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const config = getConfig(c.env, c.req.raw);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  let registration: RegistrationRecord | null = null;
  if (body.token) {
    const verified = await verifyDatabaseCapability({
      db: c.env.DB,
      signingSecret: requireInternalSecret(c.env),
      purpose: "registration_confirm",
      token: body.token,
    });
    if (verified.ok && (!body.id || body.id === verified.resourceId)) {
      registration = await first<RegistrationRecord>(
        c.env.DB,
        `SELECT * FROM registrations
         WHERE id = ? AND event_id = ? AND status = 'pending_email_confirmation'`,
        [verified.resourceId, event.id],
      );
    }
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
  await run(
    c.env.DB,
    `UPDATE registrations
     SET    confirmation_reminder_sent_at = ?,
            updated_at = ?
     WHERE  id = ?`,
    [now, now, registration.id],
  );

  // Retrieve the attendee so we can personalise the email.
  const user = await first<UserRecord>(c.env.DB, "SELECT * FROM users WHERE id = ?", [registration.user_id]);
  if (!user) {
    throw new AppError(500, "USER_NOT_FOUND", "Associated user record is missing");
  }

  // This confirmation email does not need a direct management capability.
  // The generic event page lets the attendee request one by email if needed.
  const manageUrl = `${appBaseUrl}/events/${event.slug}/manage`;

  const confirmationUrl = registrationConfirmPageUrl(
    appBaseUrl,
    event,
    queuedCapabilityToken("registration_confirm", registration.id, config.confirmationLinkTtlHours * 60 * 60),
    registration.id,
  );
  const dayAttendanceRaw = await getRegistrationDayAttendance(c.env.DB, registration.id);
  const dayWaitlist = await listDayWaitlistForRegistration(c.env.DB, registration.id);
  const attendanceData = buildAttendanceEmailData(registration.attendance_type, dayAttendanceRaw, dayWaitlist);
  const statusData = buildRegistrationEmailStatusData(registration.status, dayWaitlist);
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
    capabilityLinkValues: [confirmationUrl],
    data: {
      ...buildEventEmailVariables(event, appBaseUrl),
      // User
      firstName: user.first_name ?? "",
      lastName: user.last_name ?? "",
      email: user.email,
      organizationName: user.organization_name ?? "",
      jobTitle: user.job_title ?? "",
      // Registration
      attendanceLabel: attendanceData.attendanceLabel,
      dayAttendance: attendanceData.dayAttendance,
      customAnswerRows,
      acceptedTermsText: acceptedTermsText || undefined,
      dayWaitlist,
      ...statusData,
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
  schema = registrationResendConfirmationRouteSchema;

  async handle(c: any) {
    return onRequestPost(c);
  }
}
