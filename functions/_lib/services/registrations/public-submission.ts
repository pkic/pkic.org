import { isStateGuardFailure } from "../../db/authorization-guard";
import { buildEventEmailVariables } from "../../email/event-email-variables";
import {
  personalPromotionImagePath,
  personalPromotionSharePath,
} from "../../../../assets/shared/personal-promotion-image";
import type { z } from "zod";
import type {
  RegistrationSubmissionResponse,
  registrationCreateSchema,
} from "../../../../assets/shared/schemas/registration";
import { AppError } from "../../errors";
import type { DatabaseLike, Env, StatementLike } from "../../types";
import { buildBadgeAttachment } from "../../email/attachments";
import { prepareQueueEmailStatement, processOutboxByIdBackground } from "../../email/outbox";
import { generateSignedRsvpAddress } from "../../email/rsvp";
import { emailPlainText } from "../../email/plain-text";
import { buildRegistrationIcs, calendarConfirmedDays } from "../../utils/calendar";
import { buildAttendanceEmailData, buildRegistrationEmailStatusData } from "../../utils/attendance";
import { buildAcceptedTermsText, buildCustomAnswerRows } from "../../utils/registration-email";
import { prepareValidatedAttendeeRegistration } from "../attendee-registration";
import { getEventBySlug, recordHugoEventBasePath } from "../events";
import { myAgendaPageUrl } from "../frontend-links";
import { findInviteByToken, type InviteRecord } from "../invites";
import { prepareBadgeRenderJob } from "../badge-render-job-statements";
import { seedGravatarAndProcessBadgeRenderJob } from "../registration-badge-regeneration";
import { commitRegistrationSubmission } from "../registration-submission";
import { registrationManageCapability } from "./capability-urls";
import { readRegistrationAffiliation } from "./selected-identity";
import type { VerifiedRegistrationIdentityContext } from "./types";
import { persistedUtcInstant } from "../../utils/time";
import {
  inviteSentToAccount,
  prepareGroupEventRegistrationGuard,
  readRegistrationAccessEvidence,
} from "./authorization";
import {
  eventTakesRegistrations,
  registrationAllowsPublicAccess,
  requireRegistrationPolicy,
} from "./registration-policy";
import {
  isTicketCodeSpent,
  planRegistrationTicket,
  ticketCodeExhaustedError,
} from "../event-tickets/registration-ticket";
import { HELD_UNTIL_PAID } from "../event-tickets/payment";
import { prepareTicketPaymentEmail } from "../event-tickets/payment-emails";
import { uuid } from "../../utils/ids";
import { readRefundPolicy } from "../event-tickets/refund-policy";

/** The individual capacity only gates the public contract's work-email policy; the use case does not read it. */
type RegistrationCreateInput = Omit<z.infer<typeof registrationCreateSchema>, "unaffiliatedAttestation">;

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
  referralCodeLength: number;
  /** Every registration belongs to a signed-in account; its session proved the mailbox. */
  verifiedIdentity: VerifiedRegistrationIdentityContext;
  authorizationGuards?: readonly StatementLike[];
}

/** Canonical registration use case shared by the event and group registration routes. */
export async function submitEventRegistration(
  db: DatabaseLike,
  env: Env,
  body: RegistrationCreateInput,
  metadata: EventRegistrationSubmissionMetadata,
): Promise<PublicRegistrationSubmissionResult> {
  const event = await getEventBySlug(db, metadata.eventSlug);
  const startsAt = persistedUtcInstant(event.starts_at);
  await recordHugoEventBasePath(db, event, metadata.eventBasePath);

  let linkedInvite: InviteRecord | null = null;
  if (body.inviteToken) {
    linkedInvite = await findInviteByToken(db, body.inviteToken, metadata.signingSecret, body.inviteId);
    if (linkedInvite.event_id !== event.id || linkedInvite.invite_type !== "attendee") {
      throw new AppError(400, "INVITE_INVALID", "Invite token is not valid for attendee registration for this event");
    }
    // An invitation-only event admits only the invited person; on an open event a forwarded link is an ordinary registration.
    if (!(await inviteSentToAccount(db, metadata.verifiedIdentity.userId, linkedInvite.invitee_email))) {
      if (!registrationAllowsPublicAccess(event.registration_mode))
        throw new AppError(
          403,
          "INVITE_FOR_ANOTHER_ADDRESS",
          "This invitation was sent to another email address. Sign in with that address, or add it to your account.",
        );
      linkedInvite = null;
    }
  }
  let verifiedIdentity = metadata.verifiedIdentity;
  const authorizationGuards = [...(metadata.authorizationGuards ?? [])];
  let invite = linkedInvite;
  if (!invite && eventTakesRegistrations(event.registration_mode)) {
    // The session proved the account's mailbox, so an invitation sent to it counts without its link.
    const access = await readRegistrationAccessEvidence(db, {
      eventId: event.id,
      userId: verifiedIdentity.userId,
      discoverGroup: !verifiedIdentity.registrationGroupId && !registrationAllowsPublicAccess(event.registration_mode),
    });
    invite = access.invite;
    if (access.registrationGroupId && !invite) {
      verifiedIdentity = { ...verifiedIdentity, registrationGroupId: access.registrationGroupId };
      authorizationGuards.push(
        prepareGroupEventRegistrationGuard(db, {
          eventId: event.id,
          groupId: access.registrationGroupId,
          userId: verifiedIdentity.userId,
        }),
      );
    }
  }
  requireRegistrationPolicy(event.registration_mode, {
    invited: Boolean(invite),
    authorizedByGroup: Boolean(verifiedIdentity.registrationGroupId),
  });

  const { prepared, requiredTerms, formResponse } = await prepareValidatedAttendeeRegistration(db, body, {
    sourceType: linkedInvite ? "invite" : body.sourceType,
    sourceRef: body.sourceRef,
    referredByCode: body.referralCode,
    invite,
    ip: metadata.clientIp,
    userAgent: metadata.userAgent,
    signingSecret: metadata.signingSecret,
    referralCodeLength: metadata.referralCodeLength,
    authorizationGuards,
    event: { id: event.id, source_mode: event.source_mode },
    verifiedIdentity,
  });
  const { user, referralCode } = prepared;
  const registration = prepared.registration;
  // The session proved the mailbox, so the registration is confirmed at once.
  if (registration.status !== "registered") {
    throw new AppError(500, "REGISTRATION_NOT_CONFIRMED", "A signed-in registration must be confirmed at once");
  }
  // The manage capability travels only through the durable email outbox; the portal serves the signed-in person.
  const { manageUrl: queuedManageUrl } = await registrationManageCapability(metadata.appBaseUrl, event, registration);
  const shareUrl = `${metadata.appBaseUrl}${personalPromotionSharePath(referralCode)}`;
  const dayWaitlist = prepared.plannedDayWaitlist;
  const attendanceData = buildAttendanceEmailData(prepared.dayAttendance, dayWaitlist);
  const statusData = buildRegistrationEmailStatusData(registration.status, dayWaitlist);
  const customAnswerRows = buildCustomAnswerRows(formResponse.answers, formResponse.form?.fields);
  const acceptedTermsText = buildAcceptedTermsText(body.consents, requiredTerms);
  const affiliation = await readRegistrationAffiliation(db, {
    identityId: registration.registration_identity_id,
    userId: user.id,
  });
  const commonData = {
    ...buildEventEmailVariables(event, metadata.appBaseUrl),
    firstName: user.first_name ?? "",
    lastName: user.last_name ?? "",
    email: user.email,
    organizationName: emailPlainText(affiliation.organizationName ?? ""),
    jobTitle: affiliation.jobTitle ?? "",
    attendanceLabel: attendanceData.attendanceLabel,
    dayAttendance: attendanceData.dayAttendance,
    ...attendanceData.venueDayStanding,
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

  // The ticket is issued with the registration. One that must be paid holds
  // the confirmation until the payment arrives.
  const ticket = await planRegistrationTicket(db, env, {
    event,
    registrationId: registration.id,
    userId: user.id,
    email: user.email,
    identityId: registration.registration_identity_id ?? null,
    organizationName: affiliation.organizationName,
    dayAttendance: prepared.dayAttendance.map((day) => ({ dayDate: day.dayDate, attendanceType: day.attendanceType })),
  });
  const awaitingPayment = ticket?.status === "pending_payment";
  const rsvpEmail = env.INTERNAL_SIGNING_SECRET
    ? await generateSignedRsvpAddress(registration.id, env.INTERNAL_SIGNING_SECRET, env.RSVP_EMAIL)
    : undefined;
  const calendar = await buildRegistrationIcs(
    event,
    registration.id,
    queuedManageUrl,
    calendarConfirmedDays(prepared.dayAttendance, dayWaitlist),
    metadata.appBaseUrl,
    rsvpEmail,
    user.email,
    env.INTERNAL_SIGNING_SECRET,
  );
  const queuedEmail = prepareQueueEmailStatement(db, {
    eventId: event.id,
    baseUrl: metadata.appBaseUrl,
    templateKey: "registration_confirmed",
    recipientEmail: user.email,
    recipientUserId: user.id,
    messageType: "transactional",
    subject: `Registration confirmed for ${event.name}`,
    capabilityLinkValues: [queuedManageUrl],
    ...(awaitingPayment
      ? { sendAt: HELD_UNTIL_PAID }
      : { sendAfterSeconds: env.ASSETS_BUCKET ? Number(env.EMAIL_BADGE_DELAY_SECONDS ?? 90) : 0 }),
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
      hasCalendarInvite: calendar.files.length > 0,
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

  const badgeRenderJob = prepareBadgeRenderJob(db, referralCode);
  // The payment request states the refund terms a payment made now falls under.
  const refundPolicy = awaitingPayment
    ? await readRefundPolicy(db, event.id)
    : { refundableUntil: null, refundFee: 0, transferable: false };
  // The request for payment goes out with the response, not on the outbox's next run.
  const paymentEmailId = uuid();
  const ticketStatements = ticket
    ? [
        ...ticket.statements,
        ...(awaitingPayment
          ? [
              db
                .prepare(
                  "UPDATE registration_tickets SET held_email_id = ? WHERE registration_id = ? AND status = 'pending_payment'",
                )
                .bind(queuedEmail.id, registration.id),
              prepareTicketPaymentEmail(
                db,
                metadata.appBaseUrl,
                {
                  event_id: event.id,
                  event_slug: event.slug,
                  event_name: event.name,
                  ticket_name: ticket.ticketName,
                  email: user.email,
                  amount: ticket.amount,
                  currency: ticket.currency,
                  timezone: event.timezone,
                  refund_deadline: refundPolicy.refundableUntil,
                  refund_fee: refundPolicy.refundFee,
                  transferable: refundPolicy.transferable,
                  pay_by: ticket.payBy,
                },
                {
                  templateKey: "ticket_payment_request",
                  idempotencyKey: `ticket-payment:${registration.id}:${registration.updated_at}`,
                  userId: user.id,
                  outboxId: paymentEmailId,
                },
              ),
            ]
          : []),
      ]
    : [];
  try {
    await commitRegistrationSubmission(db, prepared, [
      queuedEmail.statement,
      badgeRenderJob.statement,
      ...ticketStatements,
    ]);
  } catch (error) {
    if (isStateGuardFailure(error) && (await isTicketCodeSpent(db, ticket?.claimedCodeId)))
      throw ticketCodeExhaustedError();
    throw error;
  }
  return {
    response: {
      success: true,
      registrationId: registration.id,
      status: registration.status,
      startsAt,
      shareUrl,
      dayAttendance: prepared.dayAttendance,
      dayWaitlist,
    },
    backgroundTasks: [
      seedGravatarAndProcessBadgeRenderJob(db, env, {
        userId: user.id,
        email: user.email,
        jobId: badgeRenderJob.id,
      }).then(() => processOutboxByIdBackground(db, env, awaitingPayment ? paymentEmailId : queuedEmail.id)),
    ],
  };
}
