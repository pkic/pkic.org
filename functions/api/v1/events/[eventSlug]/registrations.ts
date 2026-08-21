import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { AppError } from "../../../../_lib/errors";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { buildEventEmailVariables, getEventBySlug, updateEventBasePath } from "../../../../_lib/services/events";
import { findInviteByToken, type InviteRecord } from "../../../../_lib/services/invites";
import { commitRegistrationSubmission } from "../../../../_lib/services/registration-submission";
import { prepareValidatedAttendeeRegistration } from "../../../../_lib/services/attendee-registration";
import { trySeedGravatarThenPrerender } from "../../../../_lib/services/og-badge-prerender";
import { buildBadgeAttachment } from "../../../../_lib/email/attachments";
import { prepareQueueEmailStatement, processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { generateSignedRsvpAddress } from "../../../../_lib/email/rsvp";
import { buildRegistrationIcs } from "../../../../_lib/utils/calendar";
import { getClientIp, getUserAgent, requireInternalSecret } from "../../../../_lib/request";
import { buildAttendanceEmailData, buildRegistrationEmailStatusData } from "../../../../_lib/utils/attendance";
import { buildAcceptedTermsText, getCustomAnswerRows } from "../../../../_lib/utils/registration-email";
import { registrationConfirmPageUrl, registrationManagePageUrl } from "../../../../_lib/services/frontend-links";
import { checkEmailDomainMx } from "../../../../_lib/email/mx-check";
import { registrationCreateSchema } from "../../../../../assets/shared/schemas/api";
import { queuedCapabilityToken } from "../../../../_lib/services/capability-links";

export async function onRequestPost(c: any): Promise<Response> {
  const config = getConfig(c.env, c.req.raw);
  const signingSecret = requireInternalSecret(c.env);
  const body = await parseJsonBody(c.req, registrationCreateSchema);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));

  // Validate the email domain has MX records before proceeding.
  const mxResult = await checkEmailDomainMx(body.email);
  if (!mxResult.hasMxRecords) {
    throw new AppError(
      422,
      "EMAIL_DOMAIN_INVALID",
      "The email domain does not appear to accept mail. Please check the address and try again.",
    );
  }

  // Record the Hugo page URL sent by the browser so base_path is always the
  // real event page location, not a hardcoded pattern.
  await updateEventBasePath(c.env.DB, event.id, c.req.raw.headers.get("x-event-base-path"));

  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  let invite: InviteRecord | null = null;
  if (body.inviteToken) {
    invite = await findInviteByToken(c.env.DB, body.inviteToken, signingSecret, body.inviteId);
    if (invite.event_id !== event.id || invite.invite_type !== "attendee") {
      throw new AppError(400, "INVITE_INVALID", "Invite token is not valid for attendee registration for this event");
    }
    // For promotion invites, users can register with any email address
    // TODO: For attendee invites, enforce that the registration email matches the invite email
    // if (invite.invitee_email && invite.invitee_email.toLowerCase() !== body.email.toLowerCase()) {
    //   throw new AppError(400, "INVITE_EMAIL_MISMATCH", "Invite email and registration email must match");
    // }
  }

  const { prepared, requiredTerms } = await prepareValidatedAttendeeRegistration(c.env.DB, body, {
    eventId: event.id,
    sourceType: invite ? "invite" : body.sourceType,
    sourceRef: body.sourceRef,
    referredByCode: body.referralCode,
    invite,
    ip: getClientIp(c.req.raw),
    userAgent: getUserAgent(c.req.raw),
    pendingConfirmationDeadlineHours:
      (config.maxPendingConfirmationReminders + 1) * config.pendingConfirmationReminderIntervalDays * 24,
    signingSecret,
    confirmationTtlHours: config.confirmationLinkTtlHours,
    referralCodeLength: config.referralCodeLength,
  });
  const user = prepared.user;
  const created = prepared;
  const referralCode = prepared.referralCode;

  const manageUrl = registrationManagePageUrl(appBaseUrl, event, created.manageToken);
  const queuedManageUrl = registrationManagePageUrl(
    appBaseUrl,
    event,
    queuedCapabilityToken("registration_manage", created.registration.id),
  );
  const shareUrl = `${appBaseUrl}/r/${referralCode}`;

  const dayAttendanceRaw = prepared.dayAttendance;
  const dayWaitlist = prepared.plannedDayWaitlist;
  const attendanceData = buildAttendanceEmailData(created.registration.attendance_type, dayAttendanceRaw, dayWaitlist);
  const statusData = buildRegistrationEmailStatusData(created.registration.status, dayWaitlist);
  const customAnswerRows = await getCustomAnswerRows(c.env.DB, event.id, created.registration.custom_answers_json);
  const acceptedTermsText = buildAcceptedTermsText(body.consents, requiredTerms);
  let queuedEmail: ReturnType<typeof prepareQueueEmailStatement>;

  if (created.registration.status === "pending_email_confirmation") {
    const confirmationUrl = registrationConfirmPageUrl(
      appBaseUrl,
      event,
      queuedCapabilityToken("registration_confirm", created.registration.id, config.confirmationLinkTtlHours * 60 * 60),
      created.registration.id,
    );
    queuedEmail = prepareQueueEmailStatement(c.env.DB, {
      eventId: event.id,
      baseUrl: appBaseUrl,
      templateKey: "registration_confirm_email",
      recipientEmail: user.email,
      recipientUserId: user.id,
      messageType: "transactional",
      subject: `Confirm your registration for ${event.name}`,
      capabilityLinkValues: [confirmationUrl, queuedManageUrl],
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
        dayWaitlist,
        customAnswerRows,
        acceptedTermsText: acceptedTermsText || undefined,
        ...statusData,
        registrationId: created.registration.id,
        // URLs
        confirmationUrl,
        manageUrl: queuedManageUrl,
        shareUrl,
        linkedinShareUrl: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
        twitterShareUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`I just registered for ${event.name} — join me! ${shareUrl}`)}`,
        blueskyShareUrl: `https://bsky.app/intent/compose?text=${encodeURIComponent(`I just registered for ${event.name} — join me!\n${shareUrl}`)}`,
        redditShareUrl: `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(`Join me at ${event.name}`)}`,
        badgeImageUrl: `${appBaseUrl}/api/v1/og/${referralCode}`,
      },
    });
  } else {
    const rsvpEmail = c.env.INTERNAL_SIGNING_SECRET
      ? await generateSignedRsvpAddress(created.registration.id, c.env.INTERNAL_SIGNING_SECRET, c.env.RSVP_EMAIL)
      : undefined;
    const calendar = await buildRegistrationIcs(
      event,
      created.registration.id,
      queuedManageUrl,
      dayAttendanceRaw,
      appBaseUrl,
      rsvpEmail,
      user.email,
      c.env.INTERNAL_SIGNING_SECRET,
    );
    queuedEmail = prepareQueueEmailStatement(c.env.DB, {
      eventId: event.id,
      baseUrl: appBaseUrl,
      templateKey: "registration_confirmed",
      recipientEmail: user.email,
      recipientUserId: user.id,
      messageType: "transactional",
      subject: `Registration confirmed for ${event.name}`,
      capabilityLinkValues: [queuedManageUrl],
      // Delay so the OG badge has time to render before we try to attach it.
      // EMAIL_BADGE_DELAY_SECONDS=0 in .dev.vars skips the delay for local/e2e.
      sendAfterSeconds: c.env.ASSETS_BUCKET ? Number(c.env.EMAIL_BADGE_DELAY_SECONDS ?? 90) : 0,
      attachments: [
        buildBadgeAttachment({
          badgeCode: referralCode,
          badgeType: "attendee",
          firstName: user.first_name ?? "",
          lastName: user.last_name ?? "",
        }),
      ],
      data: {
        ...buildEventEmailVariables(event, appBaseUrl),
        // User
        firstName: user.first_name ?? "",
        lastName: user.last_name ?? "",
        email: user.email,
        organizationName: user.organization_name ?? "",
        jobTitle: user.job_title ?? "",
        // Registration
        attendanceType: created.registration.attendance_type,
        attendanceLabel: attendanceData.attendanceLabel,
        dayAttendance: attendanceData.dayAttendance,
        dayWaitlist,
        customAnswerRows,
        acceptedTermsText: acceptedTermsText || undefined,
        ...statusData,
        registrationId: created.registration.id,
        // URLs
        manageUrl: queuedManageUrl,
        shareUrl,
        linkedinShareUrl: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
        twitterShareUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`I just registered for ${event.name} — join me! ${shareUrl}`)}`,
        blueskyShareUrl: `https://bsky.app/intent/compose?text=${encodeURIComponent(`I just registered for ${event.name} — join me!\n${shareUrl}`)}`,
        redditShareUrl: `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(`Join me at ${event.name}`)}`,
        badgeImageUrl: `${appBaseUrl}/api/v1/og/${referralCode}`,
      },
      bounceAddress: rsvpEmail,
      calendar: {
        registrationId: created.registration.id,
        eventId: event.id,
        icsUid: calendar.uid,
        icsFiles: calendar.files,
        inlineContent: calendar.inlineContent,
      },
    });
  }
  await commitRegistrationSubmission(c.env.DB, prepared, [queuedEmail.statement]);
  c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, queuedEmail.id));
  c.executionCtx.waitUntil(trySeedGravatarThenPrerender(user.id, user.email, referralCode, c.env, appBaseUrl));

  return json({
    success: true,
    registrationId: created.registration.id,
    status: created.registration.status,
    manageToken: created.manageToken,
    manageUrl,
    shareUrl,
  });
}

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPost(c);
}
