import type { z } from "zod";
import type { DatabaseLike, StatementLike } from "../types";
import type { EventRecord } from "./events";
import type { UserRecord } from "./users";
import { proposalCreateSchema } from "../../../assets/shared/schemas/proposal-management";
import type { AuthenticatedIdentity } from "../auth/user-session";
import { prepareProposalSubmitter } from "./proposal-submitter";
import { prepareIdentityProfileCompletion } from "./identities/profile-completion";
import { buildFindOrCreateUserStatement } from "./users";
import { normalizeEmail } from "../validation";
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
import { formatProposalSpeakerLineup } from "./proposal-invite-person";
import { eventInviteWindowEvidence, resolveEventInviteExpiry } from "../invite-validity";
import { nowIso } from "../utils/time";
import { sha256Hex } from "../utils/crypto";
import { isEmailReservationConflict } from "./user-emails";
import { proposalTermsDigest } from "./event-proposal-proof-capabilities";
import { prepareIndependentDisclosure, requireIndependentDisclosure } from "./proposal-speaker-independent-disclosure";
import { prepareInvitedSpeakerRepresentation } from "./proposal-invited-speaker-identity";

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
    committeeNotes: input.body.proposal.committeeNotes,
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
  if (input.body.unaffiliatedAttestation)
    statements.push(
      ...prepareIndependentDisclosure(db, {
        proposalId: created.proposal.id,
        proposalSpeakerId: proposerSpeaker.speakerId,
        userId: proposer.id,
        email: submitter.profile.email,
        disclosure: requireIndependentDisclosure(input.body.independentCapacity),
        actor: { type: "user", id: proposer.id },
        at: inviteNow,
      }),
    );
  // The proposer's own submitted biography and links complete the identity they speak as where it is
  // blank; they never replace it and are never kept on the proposal.
  statements.push(
    ...prepareIdentityProfileCompletion(db, {
      userId: proposer.id,
      identityId: actingIdentity.identityId,
      biography: submitter.profile.bio,
      links: submitter.profile.links,
      at: inviteNow,
      actor: { type: "user", id: proposer.id },
      scope: { type: "proposal", id: created.proposal.id },
    }),
  );

  const coSpeakers: Array<{ user: UserRecord; manageToken: string }> = [];
  for (const speaker of input.body.speakers) {
    const userWrite = await buildFindOrCreateUserStatement(db, profileWrite(speaker));
    statements.push(...userWrite.statements);
    const actingIdentity = await prepareInvitedSpeakerRepresentation(db, {
      userId: userWrite.user.id,
      email: speaker.email,
      at: inviteNow,
    });
    const preparedSpeaker = await buildAddProposalSpeaker(db, {
      proposalId: created.proposal.id,
      userId: userWrite.user.id,
      role: speaker.role,
      invitedEmail: normalizeEmail(speaker.email),
      inviteExpiresAt: coSpeakerExpiresAt,
      proposalContext,
      actingIdentity,
    });
    // A co-speaker's bio, links and photo are their own to write when they confirm; the proposer
    // only names who to invite.
    statements.push(...preparedSpeaker.statements);
    coSpeakers.push({ user: userWrite.user, manageToken: preparedSpeaker.manageToken });
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
    organization_name: actingIdentity ? actingIdentity.representation.organizationName : null,
  };
  // An invitation names only confirmed speakers: the proposer, once they speak as a chosen representation.
  const confirmedLineupText = formatProposalSpeakerLineup(actingIdentity ? [proposerRepresentation] : []);
  // The proposer is told the names they typed for the people they invited, never a stored profile.
  const proposerLineupText = formatProposalSpeakerLineup([
    proposerRepresentation,
    ...input.body.speakers.map((speaker) => ({
      first_name: speaker.firstName,
      last_name: speaker.lastName,
      organization_name: null,
    })),
  ]);
  const invitedByDisplay =
    formatInvitePerson(proposer.first_name, proposer.last_name, proposerRepresentation.organization_name) ||
    "The proposer";
  const inviteEmailContext = {
    invitedByDisplay,
    inviterFirstName: proposer.first_name ?? "",
    proposalTitle: created.proposal.title,
    proposalAbstract: created.proposal.abstract,
  };
  const inviteEmailText = proposalInviteEmailTextVariables({
    ...inviteEmailContext,
    speakerLineupText: confirmedLineupText,
  });
  const proposerEmailText = proposalInviteEmailTextVariables({
    ...inviteEmailContext,
    speakerLineupText: proposerLineupText,
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
      subject: `Speaker invitation: please confirm — ${input.event.name}`,
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
      ...proposerEmailText,
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
