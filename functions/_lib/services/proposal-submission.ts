import type { z } from "zod";
import type { DatabaseLike, StatementLike } from "../types";
import type { EventRecord } from "./events";
import type { UserRecord } from "./users";
import { proposalCreateSchema } from "../../../assets/shared/schemas/proposal-management";
import { serializeLinks } from "../../../assets/shared/schemas/links";
import { buildFindOrCreateUserStatement } from "./users";
import { buildAddProposalSpeaker, buildCreateProposal, formatInvitePerson } from "./proposals";
import { prepareConsentStatements } from "./consent";
import { prepareAcceptInviteStatements, type InviteRecord } from "./invites";
import { prepareReferralCodeStatement } from "./referrals";
import { prepareQueueEmailStatement } from "../email/outbox";
import { emailPlainText } from "../email/plain-text";
import { buildEventEmailVariables } from "./events";
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
import { isAuthorizationGuardFailure } from "../db/authorization-guard";
import { AppError } from "../errors";
import { proposalInviteEmailTextVariables } from "./proposal-invite-email-context";

type ProposalCreateInput = z.infer<typeof proposalCreateSchema>;

export interface ProposalSubmissionInput {
  event: EventRecord;
  body: ProposalCreateInput;
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

function profileWrite(profile: ProposalCreateInput["proposer"] | ProposalCreateInput["speakers"][number]) {
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
  const proposerWrite = await buildFindOrCreateUserStatement(db, profileWrite(input.body.proposer));
  if (proposerWrite.statement) statements.push(proposerWrite.statement);
  const proposer = proposerWrite.user;

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
  });
  statements.push(...proposerSpeaker.statements);

  const coSpeakers: Array<{ user: UserRecord; manageToken: string }> = [];
  for (const speaker of input.body.speakers) {
    const userWrite = await buildFindOrCreateUserStatement(db, profileWrite(speaker));
    if (userWrite.statement) statements.push(userWrite.statement);
    const preparedSpeaker = await buildAddProposalSpeaker(db, {
      proposalId: created.proposal.id,
      userId: userWrite.user.id,
      role: speaker.role,
      proposalContext,
    });
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

  const allPeople = [proposer, ...coSpeakers.map(({ user }) => user)];
  const speakerLineupText = allPeople
    .map(
      (person) =>
        `- ${formatInvitePerson(person.first_name, person.last_name, person.organization_name, person.email)}`,
    )
    .join("\n");
  const invitedByDisplay = formatInvitePerson(
    proposer.first_name,
    proposer.last_name,
    proposer.organization_name,
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
  const proposerEmail = prepareQueueEmailStatement(db, {
    eventId: input.event.id,
    templateKey: "proposal_submitted",
    recipientEmail: proposer.email,
    recipientUserId: proposer.id,
    messageType: "transactional",
    subject: `Proposal submitted: ${created.proposal.title}`,
    capabilityLinkValues: [queuedManageUrl],
    data: {
      ...eventVariables,
      firstName: emailPlainText(proposer.first_name ?? ""),
      lastName: emailPlainText(proposer.last_name ?? ""),
      ...inviteEmailText,
      proposalType: emailPlainText(created.proposal.proposal_type),
      manageUrl: queuedManageUrl,
      shareUrl: `${input.appBaseUrl}/r/${referral.code}`,
    },
  });
  statements.push(proposerEmail.statement);
  outboxIds.push(proposerEmail.id);

  try {
    await db.batch(statements);
  } catch (error) {
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
    manageToken: proposerWrite.created ? created.manageToken : null,
    manageUrl: proposerWrite.created ? proposalManagePageUrl(input.appBaseUrl, input.event, created.manageToken) : null,
    referralCode: referral.code,
    shareUrl: `${input.appBaseUrl}/r/${referral.code}`,
    proposer,
    outboxIds,
    badgeRenderJobId: badgeRenderJob.id,
  };
}
