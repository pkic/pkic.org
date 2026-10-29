import type { RegistrationOrganizationOutcome } from "../../../../assets/shared/schemas/registration";
import { readEventAffiliationContext } from "../identities/event-affiliation-context";
import {
  personalPromotionImagePath,
  personalPromotionSharePath,
} from "../../../../assets/shared/personal-promotion-image";
import type { z } from "zod";
import type {
  RegistrationConfirmOrganization,
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
import { buildAcceptedTermsText, buildCustomAnswerRows } from "../../utils/registration-email";
import { prepareValidatedAttendeeRegistration } from "../attendee-registration";
import { buildEventEmailVariables, getEventBySlug, recordHugoEventBasePath } from "../events";
import { myAgendaPageUrl, registrationManagePageUrl } from "../frontend-links";
import { findInviteByToken, type InviteRecord } from "../invites";
import { prepareBadgeRenderJob } from "../badge-render-job-statements";
import { seedGravatarAndProcessBadgeRenderJob } from "../registration-badge-regeneration";
import { commitRegistrationSubmission } from "../registration-submission";
import { registrationConfirmationUrl, registrationManageCapability } from "./capability-urls";
import { readRegistrationAffiliation } from "./selected-identity";
import type { VerifiedRegistrationIdentityContext } from "./types";
import { nowIso } from "../../utils/time";
import { linkVerifiedAddressToDomainOrganization } from "../identities/email-domain-link";
import { linkConfirmedRegistrationOrganization } from "./confirmation-organization";
import { eventTakesRegistrations } from "./email-proof";

/** The individual capacity only gates the public contract's work-email policy; the use case does not read it. */
type RegistrationCreateInput = Omit<z.infer<typeof registrationCreateSchema>, "unaffiliatedAttestation">;

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
  /** The submission carried a verification link for its address: it is registered without a confirmation email. */
  mailboxVerified?: boolean;
  authorizationGuards?: readonly StatementLike[];
}

function requireRegistrationPolicy(
  registrationMode: string,
  access: { invited: boolean; authorizedByGroup: boolean },
): void {
  // An automatic meeting invites its group's members itself (#103); like a
  // meeting without registration, it takes no registrations.
  if (!eventTakesRegistrations(registrationMode)) {
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

/**
 * After a verified registration commits, as the confirmation did: the proved
 * address joins the organization its domain belongs to when the shared rule
 * links it, and an organization the form asked for is linked or queued for
 * review in its own command, never undoing the registration.
 */
async function linkVerifiedRegistrant(
  db: DatabaseLike,
  input: {
    registrationId: string;
    userId: string;
    normalizedEmail: string;
    organization?: RegistrationConfirmOrganization;
  },
): Promise<RegistrationOrganizationOutcome | null> {
  await linkVerifiedAddressToDomainOrganization(db, { userId: input.userId, normalizedEmail: input.normalizedEmail });
  return input.organization
    ? linkConfirmedRegistrationOrganization(db, {
        registrationId: input.registrationId,
        organization: input.organization,
        at: nowIso(),
      })
    : null;
}

/** Canonical registration use case shared by public and authenticated group adapters. */
export async function submitEventRegistration(
  db: DatabaseLike,
  env: Env,
  body: RegistrationCreateInput,
  metadata: EventRegistrationSubmissionMetadata,
): Promise<PublicRegistrationSubmissionResult> {
  const event = await getEventBySlug(db, metadata.eventSlug);
  await recordHugoEventBasePath(db, event, metadata.eventBasePath);

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

  if (!metadata.verifiedIdentity && !metadata.mailboxVerified) {
    const mxResult = await checkEmailDomainMx(body.email);
    if (!mxResult.hasMxRecords) {
      throw new AppError(
        422,
        "EMAIL_DOMAIN_INVALID",
        "The email domain does not appear to accept mail. Please check the address and try again.",
      );
    }
  }

  if (body.organization?.organizationId !== undefined && !body.organization.contextToken)
    throw new AppError(409, "IDENTITY_CONTEXT_REQUIRED", "Confirm your organization details again before registering.");
  const affiliationContext =
    body.organization?.contextToken && metadata.mailboxVerified
      ? await readEventAffiliationContext(
          metadata.signingSecret,
          body.organization.contextToken,
          event.id,
          body.email,
          "registration-affiliation",
          body.organization,
        )
      : undefined;
  if (body.organization?.contextToken && !affiliationContext)
    throw new AppError(
      422,
      "REGISTRATION_EMAIL_PROOF_REQUIRED",
      "Verify your email before confirming the organization.",
    );
  const { prepared, requiredTerms, formResponse } = await prepareValidatedAttendeeRegistration(db, body, {
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
    event: { id: event.id, source_mode: event.source_mode },
    verifiedIdentity: metadata.verifiedIdentity,
    affiliationContext,
    mailboxVerified: metadata.mailboxVerified,
  });
  const { user, referralCode } = prepared;
  const registration = prepared.registration;
  const { manageUrl: queuedManageUrl } = await registrationManageCapability(metadata.appBaseUrl, event, registration);
  const manageUrl = registrationManagePageUrl(metadata.appBaseUrl, event, prepared.manageToken);
  // Email equality discovers an existing identity; it does not prove that the
  // anonymous submitter owns it. Existing identities receive their management
  // capability only through the durable email outbox. A newly created,
  // unprivileged identity may keep the immediate correction link so a typo can
  // still be fixed before confirmation. A verified mailbox is that proof.
  const exposeManageCapability = prepared.identityWasCreated || Boolean(metadata.mailboxVerified);
  const shareUrl = `${metadata.appBaseUrl}${personalPromotionSharePath(referralCode)}`;
  const dayWaitlist = prepared.plannedDayWaitlist;
  const attendanceData = buildAttendanceEmailData(registration.attendance_type, prepared.dayAttendance, dayWaitlist);
  const statusData = buildRegistrationEmailStatusData(registration.status, dayWaitlist);
  const customAnswerRows = buildCustomAnswerRows(formResponse.answers, formResponse.form?.fields);
  const acceptedTermsText = buildAcceptedTermsText(body.consents, requiredTerms);
  const affiliation =
    prepared.representation ??
    (await readRegistrationAffiliation(db, {
      identityId: registration.registration_identity_id,
      userId: user.id,
    }));
  const commonData = {
    ...buildEventEmailVariables(event, metadata.appBaseUrl),
    firstName: user.first_name ?? "",
    lastName: user.last_name ?? "",
    email: user.email,
    organizationName: affiliation.organizationName ?? "",
    jobTitle: affiliation.jobTitle ?? "",
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
    badgeImageUrl: `${metadata.appBaseUrl}${personalPromotionImagePath(referralCode)}`,
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
      data: {
        ...commonData,
        attendanceType: registration.attendance_type,
        myAgendaUrl: myAgendaPageUrl(metadata.appBaseUrl, event),
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

  const badgeRenderJob = prepareBadgeRenderJob(db, referralCode);
  await commitRegistrationSubmission(db, prepared, [queuedEmail.statement, badgeRenderJob.statement]);
  const organizationOutcome = affiliationContext
    ? (prepared.organizationOutcome ?? null)
    : metadata.mailboxVerified
      ? await linkVerifiedRegistrant(db, {
          registrationId: registration.id,
          userId: user.id,
          normalizedEmail: body.email,
          organization: body.organization,
        })
      : null;
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
      organizationOutcome,
    },
    backgroundTasks: [
      seedGravatarAndProcessBadgeRenderJob(db, env, {
        userId: user.id,
        email: user.email,
        jobId: badgeRenderJob.id,
      }).then(() => processOutboxByIdBackground(db, env, queuedEmail.id)),
    ],
  };
}

/** Public adapter name retained for the existing public route. */
export const submitPublicRegistration = submitEventRegistration;
