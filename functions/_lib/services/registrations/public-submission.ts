import type { z } from "zod";
import type {
  RegistrationSubmissionResponse,
  registrationCreateSchema,
} from "../../../../assets/shared/schemas/registration";
import { AppError } from "../../errors";
import type { DatabaseLike, Env, StatementLike } from "../../types";
import { buildBadgeAttachment } from "../../email/attachments";
import { checkEmailDomainMx } from "../../email/mx-check";
import { prepareQueueEmailStatement, processOutboxByIdBackground } from "../../email/outbox";
import { generateSignedRsvpAddress } from "../../email/rsvp";
import { buildRegistrationIcs } from "../../utils/calendar";
import { buildAttendanceEmailData, buildRegistrationEmailStatusData } from "../../utils/attendance";
import { buildAcceptedTermsText, getCustomAnswerRows } from "../../utils/registration-email";
import { prepareValidatedAttendeeRegistration } from "../attendee-registration";
import { buildEventEmailVariables, getEventBySlug, updateEventBasePath } from "../events";
import { registrationManagePageUrl } from "../frontend-links";
import { findInviteByToken, type InviteRecord } from "../invites";
import { prepareBadgeRenderJob } from "../badge-render-job-statements";
import type { EventFormResolution } from "../forms";
import { seedGravatarAndProcessBadgeRenderJob } from "../registration-badge-regeneration";
import { commitRegistrationSubmission } from "../registration-submission";
import { registrationConfirmationUrl, registrationManageCapability } from "./capability-urls";
import type { VerifiedRegistrationIdentityContext } from "./types";

type RegistrationCreateInput = z.infer<typeof registrationCreateSchema>;

export interface PublicRegistrationSubmissionConfig {
  maxPendingConfirmationReminders: number;
  pendingConfirmationReminderIntervalDays: number;
  confirmationLinkTtlHours: number;
  referralCodeLength: number;
}

export interface PublicRegistrationSubmissionResult {
  response: RegistrationSubmissionResponse;
  backgroundTasks: Promise<unknown>[];
}

export interface EventRegistrationSubmissionMetadata {
  eventSlug: string;
  eventBasePath: string | null;
  clientIp: string | null;
  userAgent: string | null;
  appBaseUrl: string;
  signingSecret: string;
  config: PublicRegistrationSubmissionConfig;
  verifiedIdentity?: VerifiedRegistrationIdentityContext;
  authorizationGuards?: readonly StatementLike[];
  formResolution?: EventFormResolution;
}

function requireRegistrationPolicy(
  registrationMode: string,
  access: { invited: boolean; authorizedByGroup: boolean },
): void {
  if (registrationMode === "no_registration") {
    throw new AppError(403, "EVENT_REGISTRATION_DISABLED", "This event does not use registration");
  }
  if (registrationMode === "public" || registrationMode === "open" || registrationMode === "invite_or_open") return;
  if (
    (registrationMode === "optional" ||
      registrationMode === "required" ||
      registrationMode === "invitation_only" ||
      registrationMode === "invite_only") &&
    (access.invited || access.authorizedByGroup)
  ) {
    return;
  }
  throw new AppError(403, "EVENT_REGISTRATION_ACCESS_REQUIRED", "Registration requires an invitation or group access");
}

/** Canonical registration use case shared by public and authenticated group adapters. */
export async function submitEventRegistration(
  db: DatabaseLike,
  env: Env,
  body: RegistrationCreateInput,
  metadata: EventRegistrationSubmissionMetadata,
): Promise<PublicRegistrationSubmissionResult> {
  const event = await getEventBySlug(db, metadata.eventSlug);
  await updateEventBasePath(db, event.id, metadata.eventBasePath);

  let invite: InviteRecord | null = null;
  if (body.inviteToken) {
    invite = await findInviteByToken(db, body.inviteToken, metadata.signingSecret, body.inviteId);
    if (invite.event_id !== event.id || invite.invite_type !== "attendee") {
      throw new AppError(400, "INVITE_INVALID", "Invite token is not valid for attendee registration for this event");
    }
  }
  requireRegistrationPolicy(event.registration_mode, {
    invited: Boolean(invite),
    authorizedByGroup: Boolean(metadata.verifiedIdentity?.registrationGroupId),
  });

  if (!metadata.verifiedIdentity) {
    const mxResult = await checkEmailDomainMx(body.email);
    if (!mxResult.hasMxRecords) {
      throw new AppError(
        422,
        "EMAIL_DOMAIN_INVALID",
        "The email domain does not appear to accept mail. Please check the address and try again.",
      );
    }
  }

  const { prepared, requiredTerms } = await prepareValidatedAttendeeRegistration(db, body, {
    eventId: event.id,
    sourceType: invite ? "invite" : body.sourceType,
    sourceRef: body.sourceRef,
    referredByCode: body.referralCode,
    invite,
    ip: metadata.clientIp,
    userAgent: metadata.userAgent,
    pendingConfirmationDeadlineHours:
      (metadata.config.maxPendingConfirmationReminders + 1) *
      metadata.config.pendingConfirmationReminderIntervalDays *
      24,
    signingSecret: metadata.signingSecret,
    confirmationTtlHours: metadata.config.confirmationLinkTtlHours,
    referralCodeLength: metadata.config.referralCodeLength,
    authorizationGuards: metadata.authorizationGuards,
    formResolution: metadata.formResolution,
    verifiedIdentity: metadata.verifiedIdentity,
  });
  const { user, referralCode } = prepared;
  const registration = prepared.registration;
  const { manageUrl: queuedManageUrl } = await registrationManageCapability(metadata.appBaseUrl, event, registration);
  const manageUrl = registrationManagePageUrl(metadata.appBaseUrl, event, prepared.manageToken);
  // Email equality discovers an existing identity; it does not prove that the
  // anonymous submitter owns it. Existing identities receive their management
  // capability only through the durable email outbox. A newly created,
  // unprivileged identity may keep the immediate correction link so a typo can
  // still be fixed before confirmation.
  const exposeManageCapability = prepared.identityWasCreated;
  const shareUrl = `${metadata.appBaseUrl}/r/${referralCode}`;
  const dayWaitlist = prepared.plannedDayWaitlist;
  const attendanceData = buildAttendanceEmailData(registration.attendance_type, prepared.dayAttendance, dayWaitlist);
  const statusData = buildRegistrationEmailStatusData(registration.status, dayWaitlist);
  const customAnswerRows = await getCustomAnswerRows(db, event.id, registration.custom_answers_json);
  const acceptedTermsText = buildAcceptedTermsText(body.consents, requiredTerms);
  const commonData = {
    ...buildEventEmailVariables(event, metadata.appBaseUrl),
    firstName: user.first_name ?? "",
    lastName: user.last_name ?? "",
    email: user.email,
    organizationName: user.organization_name ?? "",
    jobTitle: user.job_title ?? "",
    attendanceLabel: attendanceData.attendanceLabel,
    dayAttendance: attendanceData.dayAttendance,
    dayWaitlist,
    customAnswerRows,
    acceptedTermsText: acceptedTermsText || undefined,
    ...statusData,
    registrationId: registration.id,
    manageUrl: queuedManageUrl,
    shareUrl,
    linkedinShareUrl: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
    twitterShareUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`I just registered for ${event.name} — join me! ${shareUrl}`)}`,
    blueskyShareUrl: `https://bsky.app/intent/compose?text=${encodeURIComponent(`I just registered for ${event.name} — join me!\n${shareUrl}`)}`,
    redditShareUrl: `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(`Join me at ${event.name}`)}`,
    badgeImageUrl: `${metadata.appBaseUrl}/api/v1/og/${referralCode}`,
  };

  let queuedEmail: ReturnType<typeof prepareQueueEmailStatement>;
  if (registration.status === "pending_email_confirmation") {
    const confirmationUrl = await registrationConfirmationUrl(
      metadata.appBaseUrl,
      event,
      registration,
      metadata.config.confirmationLinkTtlHours,
    );
    queuedEmail = prepareQueueEmailStatement(db, {
      eventId: event.id,
      baseUrl: metadata.appBaseUrl,
      templateKey: "registration_confirm_email",
      recipientEmail: user.email,
      recipientUserId: user.id,
      messageType: "transactional",
      subject: `Confirm your registration for ${event.name}`,
      capabilityLinkValues: [confirmationUrl, queuedManageUrl],
      data: { ...commonData, confirmationUrl },
    });
  } else {
    const rsvpEmail = env.INTERNAL_SIGNING_SECRET
      ? await generateSignedRsvpAddress(registration.id, env.INTERNAL_SIGNING_SECRET, env.RSVP_EMAIL)
      : undefined;
    const calendar = await buildRegistrationIcs(
      event,
      registration.id,
      queuedManageUrl,
      prepared.dayAttendance,
      metadata.appBaseUrl,
      rsvpEmail,
      user.email,
      env.INTERNAL_SIGNING_SECRET,
    );
    queuedEmail = prepareQueueEmailStatement(db, {
      eventId: event.id,
      baseUrl: metadata.appBaseUrl,
      templateKey: "registration_confirmed",
      recipientEmail: user.email,
      recipientUserId: user.id,
      messageType: "transactional",
      subject: `Registration confirmed for ${event.name}`,
      capabilityLinkValues: [queuedManageUrl],
      sendAfterSeconds: env.ASSETS_BUCKET ? Number(env.EMAIL_BADGE_DELAY_SECONDS ?? 90) : 0,
      attachments: [
        buildBadgeAttachment({
          badgeCode: referralCode,
          badgeType: "attendee",
          firstName: user.first_name ?? "",
          lastName: user.last_name ?? "",
        }),
      ],
      data: { ...commonData, attendanceType: registration.attendance_type },
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

  const badgeRenderJob = prepareBadgeRenderJob(db, referralCode);
  await commitRegistrationSubmission(db, prepared, [queuedEmail.statement, badgeRenderJob.statement]);
  return {
    response: {
      success: true,
      registrationId: registration.id,
      status: registration.status,
      manageToken: exposeManageCapability ? prepared.manageToken : null,
      manageUrl: exposeManageCapability ? manageUrl : null,
      shareUrl,
      dayAttendance: prepared.dayAttendance,
      dayWaitlist,
    },
    backgroundTasks: [
      processOutboxByIdBackground(db, env, queuedEmail.id),
      seedGravatarAndProcessBadgeRenderJob(db, env, {
        userId: user.id,
        email: user.email,
        jobId: badgeRenderJob.id,
      }),
    ],
  };
}

/** Public adapter name retained for the existing public route. */
export const submitPublicRegistration = submitEventRegistration;
