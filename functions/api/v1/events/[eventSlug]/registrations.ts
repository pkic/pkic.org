import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { AppError } from "../../../../_lib/errors";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import {
  buildEventEmailVariables,
  getEventBySlug,
  getRequiredTerms,
  updateEventBasePath,
} from "../../../../_lib/services/events";
import { validateCustomAnswersByPurpose } from "../../../../_lib/services/forms";
import { findOrCreateUser } from "../../../../_lib/services/users";
import { acceptInvite, findInviteByToken } from "../../../../_lib/services/invites";
import { createRegistration } from "../../../../_lib/services/registrations";
import { createReferralCode } from "../../../../_lib/services/referrals";
import { trySeedGravatarThenPrerender } from "../../../../_lib/services/og-badge-prerender";
import { buildBadgeAttachment } from "../../../../_lib/email/attachments";
import { persistConsents, validateRequiredConsents } from "../../../../_lib/services/consent";
import { processOutboxByIdBackground, queueEmail } from "../../../../_lib/email/outbox";
import { generateSignedRsvpAddress } from "../../../../_lib/email/rsvp";
import { buildRegistrationIcs } from "../../../../_lib/utils/calendar";
import { getClientIp, getUserAgent, requireInternalSecret } from "../../../../_lib/request";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { deriveEventAttendanceType, getRegistrationDayAttendance } from "../../../../_lib/services/event-days";
import { listDayWaitlistForRegistration } from "../../../../_lib/services/registrations/day-waitlist";
import { buildAttendanceEmailData } from "../../../../_lib/utils/attendance";
import { buildAcceptedTermsText, getCustomAnswerRows } from "../../../../_lib/utils/registration-email";
import { registrationConfirmPageUrl, registrationManagePageUrl } from "../../../../_lib/services/frontend-links";
import { registrationCreateSchema } from "../../../../../assets/shared/schemas/api";

export async function onRequestPost(c: any): Promise<Response> {
  const config = getConfig(c.env, c.req.raw);
  const signingSecret = requireInternalSecret(c.env);
  const body = await parseJsonBody(c.req, registrationCreateSchema);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));

  // Record the Hugo page URL sent by the browser so base_path is always the
  // real event page location, not a hardcoded pattern.
  await updateEventBasePath(c.env.DB, event.id, c.req.raw.headers.get("x-event-base-path"));

  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  let inviteId: string | null = null;
  if (body.inviteToken) {
    const invite = await findInviteByToken(c.env.DB, body.inviteToken);
    if (invite.event_id !== event.id || invite.invite_type !== "attendee") {
      throw new AppError(400, "INVITE_INVALID", "Invite token is not valid for attendee registration for this event");
    }
    // For promotion invites, users can register with any email address
    // TODO: For attendee invites, enforce that the registration email matches the invite email
    // if (invite.invitee_email && invite.invitee_email.toLowerCase() !== body.email.toLowerCase()) {
    //   throw new AppError(400, "INVITE_EMAIL_MISMATCH", "Invite email and registration email must match");
    // }
    inviteId = invite.id;
  }

  // Promote known profile-field keys from custom answers to the user record.
  // This lets events configure organization_name / job_title as regular form
  // fields (sortable, required/optional per event) without losing the ability
  // to store them on the user profile for personalised future communications.
  const profileFromCustom: { organizationName?: string; jobTitle?: string } = {};
  if (typeof body.customAnswers?.organization_name === "string" && body.customAnswers.organization_name.trim()) {
    profileFromCustom.organizationName = body.customAnswers.organization_name.trim();
  }
  if (typeof body.customAnswers?.job_title === "string" && body.customAnswers.job_title.trim()) {
    profileFromCustom.jobTitle = body.customAnswers.job_title.trim();
  }

  const user = await findOrCreateUser(c.env.DB, {
    email: body.email,
    firstName: body.firstName,
    lastName: body.lastName,
    organizationName: body.organizationName ?? profileFromCustom.organizationName,
    jobTitle: body.jobTitle ?? profileFromCustom.jobTitle,
  });

  const requiredTerms = await getRequiredTerms(c.env.DB, event.id, "attendee");
  await validateRequiredConsents(requiredTerms, body.consents);
  const customAnswers = await validateCustomAnswersByPurpose(c.env.DB, {
    eventId: event.id,
    purpose: "event_registration",
    customAnswers: body.customAnswers,
  });

  const created = await createRegistration(c.env.DB, {
    event,
    userId: user.id,
    attendanceType: (body.attendanceType ?? deriveEventAttendanceType(body.dayAttendance)) as
      | "in_person"
      | "virtual"
      | "on_demand",
    dayAttendance: body.dayAttendance,
    sourceType: inviteId ? "invite" : body.sourceType,
    sourceRef: body.sourceRef,
    customAnswersJson: Object.keys(customAnswers).length > 0 ? JSON.stringify(customAnswers) : null,
    inviteId,
    referredByCode: body.referralCode,
    confirmationTtlHours: config.manageTokenTtlHours,
  });

  await persistConsents(c.env.DB, {
    registrationId: created.registration.id,
    eventId: event.id,
    userId: user.id,
    audienceType: "attendee",
    accepted: body.consents,
    ip: getClientIp(c.req.raw),
    userAgent: getUserAgent(c.req.raw),
    secret: signingSecret,
  });

  if (inviteId) {
    await acceptInvite(c.env.DB, inviteId);
  }

  const referralCode = await createReferralCode(c.env.DB, {
    eventId: event.id,
    ownerType: "registration",
    ownerId: created.registration.id,
    createdByUserId: user.id,
    length: config.referralCodeLength,
  });

  c.executionCtx.waitUntil(trySeedGravatarThenPrerender(user.id, user.email, referralCode, c.env, appBaseUrl));

  const manageUrl = registrationManagePageUrl(appBaseUrl, event, created.manageToken);
  const shareUrl = `${appBaseUrl}/r/${referralCode}`;

  const dayAttendanceRaw = await getRegistrationDayAttendance(c.env.DB, created.registration.id);
  const dayWaitlist = await listDayWaitlistForRegistration(c.env.DB, created.registration.id);
  const { attendanceLabel, dayAttendance } = buildAttendanceEmailData(
    created.registration.attendance_type,
    dayAttendanceRaw,
    dayWaitlist,
  );
  const customAnswerRows = await getCustomAnswerRows(c.env.DB, event.id, created.registration.custom_answers_json);
  const acceptedTermsText = buildAcceptedTermsText(body.consents, requiredTerms);

  if (created.registration.status === "pending_email_confirmation") {
    const confirmationUrl = registrationConfirmPageUrl(appBaseUrl, event, created.confirmationToken as string);
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
        dayWaitlist,
        customAnswerRows,
        acceptedTermsText: acceptedTermsText || undefined,
        status: created.registration.status,
        registrationId: created.registration.id,
        // URLs
        confirmationUrl,
        manageUrl,
        shareUrl,
        linkedinShareUrl: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
        twitterShareUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`I just registered for ${event.name} — join me! ${shareUrl}`)}`,
        blueskyShareUrl: `https://bsky.app/intent/compose?text=${encodeURIComponent(`I just registered for ${event.name} — join me!\n${shareUrl}`)}`,
        redditShareUrl: `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(`Join me at ${event.name}`)}`,
        badgeImageUrl: `${appBaseUrl}/api/v1/og/${referralCode}`,
      },
    });

    c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outboxId));
  } else {
    const rsvpEmail = c.env.INTERNAL_SIGNING_SECRET
      ? await generateSignedRsvpAddress(created.registration.id, c.env.INTERNAL_SIGNING_SECRET, c.env.RSVP_EMAIL)
      : undefined;
    const calendar = await buildRegistrationIcs(
      event,
      created.registration.id,
      manageUrl,
      dayAttendanceRaw,
      appBaseUrl,
      rsvpEmail,
      user.email,
      c.env.INTERNAL_SIGNING_SECRET,
    );
    const outboxId = await queueEmail(c.env.DB, {
      eventId: event.id,
      baseUrl: appBaseUrl,
      templateKey: "registration_confirmed",
      recipientEmail: user.email,
      recipientUserId: user.id,
      messageType: "transactional",
      subject: `Registration confirmed for ${event.name}`,
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
        attendanceLabel,
        dayAttendance,
        dayWaitlist,
        customAnswerRows,
        acceptedTermsText: acceptedTermsText || undefined,
        status: created.registration.status,
        registrationId: created.registration.id,
        // URLs
        manageUrl,
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

    c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outboxId));
  }

  await writeAuditLog(c.env.DB, "user", user.id, "registration_created", "registration", created.registration.id, {
    eventId: event.id,
    status: created.registration.status,
  });

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
