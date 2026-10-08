import type { z } from "zod";
import type { DatabaseLike, StatementLike } from "../types";
import type { EventRecord } from "./events";
import type { UserRecord } from "./users";
import { proposalCreateSchema } from "../../../assets/shared/schemas/proposal-management";
import type { AuthenticatedIdentity } from "../auth/user-session";
import { prepareProposalSubmitter } from "./proposal-submitter";
import { serializeLinks } from "../../../assets/shared/schemas/links";
import { buildFindOrCreateUserStatement } from "./users";
import { buildAddProposalSpeaker, buildCreateProposal, formatInvitePerson } from "./proposals";
import { prepareConsentStatements, prepareActiveTermsSnapshotGuard, validateRequiredConsents } from "./consent";
import { prepareAcceptInviteStatements, type InviteRecord } from "./invites";
import { prepareReferralCodeStatement } from "./referrals";
import { prepareQueueEmailStatement } from "../email/outbox";
import { emailPlainText } from "../email/plain-text";
import { buildEventEmailVariables, getRequiredTerms } from "./events";
import { proposalManagePageUrl, speakerManagePageUrl } from "./frontend-links";
import { queuedCapabilityToken } from "./capability-links";
import { requireConfiguredSessionType } from "./events";
import { isRegistrationTransitionConflict, registrationChangedError } from "./registrations/transition-guard";
import {
  eventParticipantSourceConflictError,
  isEventParticipantSourceConflict,
} from "./event-participant-source-revision";
import { prepareBadgeRenderJob } from "./badge-render-job-statements";
import {
  formSubmissionContextChangedError,
  isFormSubmissionContextConflict,
  prepareReplaceContextFormSubmission,
  type ActiveFormDefinition,
  type CustomAnswerValue,
} from "./forms";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import { AppError } from "../errors";
import { proposalInviteEmailTextVariables } from "./proposal-invite-email-context";
import { eventInviteWindowEvidence, resolveEventInviteExpiry } from "../invite-validity";
import { nowIso } from "../utils/time";
import { sha256Hex } from "../utils/crypto";
import { isEmailReservationConflict } from "./user-emails";
import { proposalTermsDigest } from "./event-proposal-proof-capabilities";

type ProposalCreateInput = z.infer<typeof proposalCreateSchema>;

export interface ProposalSubmissionInput {
  event: EventRecord;
  body: ProposalCreateInput;
  actor?: AuthenticatedIdentity;
  appBaseUrl: string;
  signingSecret: string;
  referralCodeLength: number;
  proposalDetails: Record<string, CustomAnswerValue>;
  acceptedInvite?: InviteRecord | null;
  ip: string | null;
  userAgent: string | null;
  formRevisionGuard?: StatementLike | null;
  formPlacementId?: string | null;
  formDefinition?: ActiveFormDefinition | null;
}

export interface ProposalSubmissionResult {
  proposalId: string;
  status: string;
  manageToken: string | null;
  manageUrl: string | null;
  referralCode: string;
  shareUrl: string;
  proposer: UserRecord;
  outboxIds: string[];
  badgeRenderJobId: string;
}

function profileWrite(profile: ProposalCreateInput["speakers"][number]) {
  return {
    email: profile.email,
    firstName: profile.firstName,
    lastName: profile.lastName,
    organizationName: profile.organizationName,
    jobTitle: profile.jobTitle,
    biography: profile.bio,
    linksJson: profile.links.length > 0 ? serializeLinks(profile.links) : undefined,
  };
}

/**
 * Commits the complete public proposal-submission aggregate exactly once:
 * users, proposal, speaker/participant projections, engagement/referral,
 * consent evidence, invite acceptance, share code, and notification outbox.
 */
export async function submitProposal(
  db: DatabaseLike,
  input: ProposalSubmissionInput,
): Promise<ProposalSubmissionResult> {
  const statements: StatementLike[] = input.formRevisionGuard && !input.formDefinition ? [input.formRevisionGuard] : [];
  const inviteNow = nowIso();
  const terms = await getRequiredTerms(db, input.event.id, "speaker");
  await validateRequiredConsents(terms, input.body.consents);
  statements.push(prepareActiveTermsSnapshotGuard(db, input.event.id, terms, "speaker"));
  const coSpeakerExpiresAt =
    input.body.speakers.length > 0 ? resolveEventInviteExpiry(input.event, undefined, inviteNow) : null;
  if (coSpeakerExpiresAt) {
    statements.push(
      prepareAuthorizationGuard(
        db,
        eventInviteWindowEvidence(input.event.id, input.event, coSpeakerExpiresAt, inviteNow),
      ),
    );
  }
  const submitter = await prepareProposalSubmitter(db, {
    eventId: input.event.id,
    body: input.body,
    actor: input.actor,
    signingSecret: input.signingSecret,
    at: inviteNow,
    acceptedInvite: input.acceptedInvite,
  });
  statements.push(...submitter.statements);
  const proposer = submitter.user;
  const actingIdentity = submitter.identity;

  const created = await buildCreateProposal(db, {
    eventId: input.event.id,
    proposerUserId: proposer.id,
    proposalType: requireConfiguredSessionType(input.event.settings_json, input.body.proposal.type),
    title: input.body.proposal.title,
    abstract: input.body.proposal.abstract,
    detailsJson: Object.keys(input.proposalDetails).length > 0 ? JSON.stringify(input.proposalDetails) : null,
    formPlacementId: input.formDefinition?.placement?.id ?? input.formPlacementId ?? null,
    referredByCode: input.body.referralCode,
    signingSecret: input.signingSecret,
  });
  statements.push(...created.statements);
  if (input.formDefinition) {
    const formSubmission = await prepareReplaceContextFormSubmission(
      db,
      input.formDefinition,
      {
        submittedByUserId: proposer.id,
        contextType: "proposal",
        contextRef: created.proposal.id,
      },
      input.proposalDetails,
      created.proposal.submitted_at,
    );
    statements.push(...formSubmission.statements);
  }

  const proposalContext = { event_id: input.event.id, status: created.proposal.status };
  const proposerSpeaker = await buildAddProposalSpeaker(db, {
    proposalId: created.proposal.id,
    userId: proposer.id,
    role: input.body.proposer.role,
    signingSecret: input.signingSecret,
    proposalContext,
    actingIdentity,
    requireRepresentationReview: !actingIdentity,
  });
  statements.push(...proposerSpeaker.statements);
  // Explicit submitted profile values belong to this proposal, never somebody's account or identity.
  const proposerOverrides = {
    ...(actingIdentity
      ? {}
      : {
          organizationName: input.body.proposer.organizationName ?? null,
          jobTitle: input.body.proposer.jobTitle ?? null,
        }),
    biography: submitter.profile.bio ?? null,
    links: submitter.profile.links,
  };
  statements.push(
    db
      .prepare("UPDATE proposal_speakers SET profile_overrides_json=? WHERE id=?")
      .bind(JSON.stringify(proposerOverrides), proposerSpeaker.speakerId),
  );

  const coSpeakers: Array<{ user: UserRecord; manageToken: string }> = [];
  for (const speaker of input.body.speakers) {
    const userWrite = await buildFindOrCreateUserStatement(db, profileWrite(speaker));
    if (userWrite.statement) statements.push(userWrite.statement);
    const preparedSpeaker = await buildAddProposalSpeaker(db, {
      proposalId: created.proposal.id,
      userId: userWrite.user.id,
      role: speaker.role,
      inviteExpiresAt: coSpeakerExpiresAt,
      proposalContext,
    });
    statements.push(...preparedSpeaker.statements);
    statements.push(
      db.prepare("UPDATE proposal_speakers SET profile_overrides_json=? WHERE id=?").bind(
        JSON.stringify({
          organizationName: speaker.organizationName ?? null,
          jobTitle: speaker.jobTitle ?? null,
          biography: speaker.bio ?? null,
          links: speaker.links,
        }),
        preparedSpeaker.speakerId,
      ),
    );
    coSpeakers.push({
      user: { ...userWrite.user, organization_name: speaker.organizationName ?? null },
      manageToken: preparedSpeaker.manageToken,
    });
  }

  statements.push(
    ...(await prepareConsentStatements(db, {
      proposalId: created.proposal.id,
      eventId: input.event.id,
      userId: proposer.id,
      audienceType: "speaker",
      accepted: input.body.consents,
      ip: input.ip,
      userAgent: input.userAgent,
      secret: input.signingSecret,
    })),
  );
  if (input.acceptedInvite) statements.push(...prepareAcceptInviteStatements(db, input.acceptedInvite));

  const referral = await prepareReferralCodeStatement(db, {
    eventId: input.event.id,
    ownerType: "proposal",
    ownerId: created.proposal.id,
    createdByUserId: proposer.id,
    length: input.referralCodeLength,
  });
  statements.push(referral.statement);
  const badgeRenderJob = prepareBadgeRenderJob(db, referral.code);
  statements.push(badgeRenderJob.statement);

  const proposerRepresentation = {
    ...proposer,
    organization_name: actingIdentity
      ? actingIdentity.snapshot.organizationName
      : (input.body.proposer.organizationName ?? null),
  };
  const allPeople = [proposerRepresentation, ...coSpeakers.map(({ user }) => user)];
  const speakerLineupText = allPeople
    .map(
      (person) =>
        `- ${formatInvitePerson(person.first_name, person.last_name, person.organization_name, person.email)}`,
    )
    .join("\n");
  const invitedByDisplay = formatInvitePerson(
    proposer.first_name,
    proposer.last_name,
    proposerRepresentation.organization_name,
    proposer.email,
  );
  const inviteEmailText = proposalInviteEmailTextVariables({
    invitedByDisplay,
    inviterFirstName: proposer.first_name ?? "",
    proposalTitle: created.proposal.title,
    proposalAbstract: created.proposal.abstract,
    speakerLineupText,
  });
  const eventVariables = buildEventEmailVariables(input.event, input.appBaseUrl);
  const outboxIds: string[] = [];

  for (const { user, manageToken } of coSpeakers) {
    const manageUrl = speakerManagePageUrl(input.appBaseUrl, input.event, manageToken);
    const email = prepareQueueEmailStatement(db, {
      eventId: input.event.id,
      templateKey: "co_speaker_invite",
      recipientEmail: user.email,
      recipientUserId: user.id,
      messageType: "transactional",
      subject: `You have been added as a speaker — ${input.event.name}`,
      capabilityLinkValues: [manageUrl],
      data: {
        ...eventVariables,
        firstName: emailPlainText(user.first_name ?? ""),
        lastName: emailPlainText(user.last_name ?? ""),
        ...inviteEmailText,
        manageUrl,
      },
    });
    statements.push(email.statement);
    outboxIds.push(email.id);
  }

  const queuedManageUrl = proposalManagePageUrl(
    input.appBaseUrl,
    input.event,
    queuedCapabilityToken("proposal_manage", created.proposal.id),
  );
  const speakerManageUrl = speakerManagePageUrl(input.appBaseUrl, input.event, proposerSpeaker.manageToken);
  const proposerEmail = prepareQueueEmailStatement(db, {
    eventId: input.event.id,
    templateKey: "proposal_submitted",
    recipientEmail: proposer.email,
    recipientUserId: proposer.id,
    messageType: "transactional",
    subject: `Proposal submitted: ${created.proposal.title}`,
    capabilityLinkValues: [queuedManageUrl, speakerManageUrl],
    data: {
      ...eventVariables,
      firstName: emailPlainText(proposer.first_name ?? ""),
      lastName: emailPlainText(proposer.last_name ?? ""),
      ...inviteEmailText,
      proposalType: emailPlainText(created.proposal.proposal_type),
      manageUrl: queuedManageUrl,
      speakerManageUrl,
      shareUrl: `${input.appBaseUrl}/r/${referral.code}`,
    },
  });
  statements.push(proposerEmail.statement);
  outboxIds.push(proposerEmail.id);
  if (!actingIdentity) {
    const reviewEmail = prepareQueueEmailStatement(db, {
      outboxId: (await sha256Hex(`proposal-representation-review:${proposerSpeaker.speakerId}`)).slice(0, 32),
      idempotencyKey: `proposal-representation-review:${proposerSpeaker.speakerId}`,
      eventId: input.event.id,
      templateKey: "proposal_representation_review",
      recipientEmail: proposer.email,
      recipientUserId: proposer.id,
      messageType: "transactional",
      subject: `Review your speaker representation — ${input.event.name}`,
      capabilityLinkValues: [speakerManageUrl],
      data: {
        ...eventVariables,
        firstName: emailPlainText(proposer.first_name ?? ""),
        proposalTitle: emailPlainText(created.proposal.title),
        speakerManageUrl,
      },
    });
    statements.push(reviewEmail.statement);
    outboxIds.push(reviewEmail.id);
  }

  try {
    await db.batch(statements);
  } catch (error) {
    if (
      isAuthorizationGuardFailure(error) &&
      (await proposalTermsDigest(await getRequiredTerms(db, input.event.id, "speaker"))) !==
        (await proposalTermsDigest(terms))
    )
      throw new AppError(409, "PROPOSAL_TERMS_CHANGED", "The event terms changed. Review them before submitting.", {
        consents: "Review the current event terms.",
      });
    if (
      input.body.continuationToken &&
      error instanceof Error &&
      (error.message.includes("uq_audit_log_idempotency_key") || error.message.includes("audit_log.idempotency_key"))
    )
      throw new AppError(409, "PROPOSAL_PROOF_USED", "This email confirmation has already submitted a proposal.");
    if (isEmailReservationConflict(error))
      throw new AppError(
        409,
        "PROPOSAL_PERSON_CHANGED",
        "The confirmed email's account changed. Confirm your email again.",
      );
    if (actingIdentity && isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "PROPOSAL_IDENTITY_CHANGED",
        "Your session or identity changed while the proposal was submitted.",
      );
    }
    if (input.acceptedInvite && isAuthorizationGuardFailure(error)) {
      throw new AppError(410, "INVITE_EXPIRED", "Invite link has expired");
    }
    if (isFormSubmissionContextConflict(error)) throw formSubmissionContextChangedError();
    if (isRegistrationTransitionConflict(error)) throw registrationChangedError();
    if (isEventParticipantSourceConflict(error)) throw eventParticipantSourceConflictError();
    throw error;
  }

  return {
    proposalId: created.proposal.id,
    status: created.proposal.status,
    // Do not turn anonymous email equality into ownership of an existing
    // account. Existing identities receive the durable proposal management
    // capability only at their canonical email address. New identities remain
    // able to continue immediately because they carry no pre-existing account
    // authority or data.
    manageToken: submitter.created ? created.manageToken : null,
    manageUrl: submitter.created ? proposalManagePageUrl(input.appBaseUrl, input.event, created.manageToken) : null,
    referralCode: referral.code,
    shareUrl: `${input.appBaseUrl}/r/${referral.code}`,
    proposer,
    outboxIds,
    badgeRenderJobId: badgeRenderJob.id,
  };
}
