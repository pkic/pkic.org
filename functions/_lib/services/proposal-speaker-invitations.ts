import { prepareQueueEmailStatement } from "../email/outbox";
import { emailPlainText } from "../email/plain-text";
import type { DatabaseLike, StatementLike } from "../types";
import { sha256Hex } from "../utils/crypto";
import type { EventRecord } from "./events";
import { buildEventEmailVariables } from "./events";
import { speakerManagePageUrl } from "./frontend-links";
import { buildProposalInviteEmailContext, proposalInviteEmailTextVariables } from "./proposal-invite-email-context";
import { buildAddProposalSpeaker, formatInvitePerson } from "./proposal-speakers";
import type { ProposalRecord } from "./proposals";
import { buildFindOrCreateUserStatement } from "./users";
import type { ProposalSpeakerRole } from "../../../assets/shared/schemas/participant-roles";
import { isProposalSpeakerRosterEditableStatus } from "../../../assets/shared/schemas/proposal-status";
import { isAuditOneChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import { AppError } from "../errors";
import { isRegistrationTransitionConflict, registrationChangedError } from "./registrations/transition-guard";
import {
  eventParticipantSourceConflictError,
  isEventParticipantSourceConflict,
} from "./event-participant-source-revision";

export interface ProposalSpeakerInvitation {
  proposal: ProposalRecord;
  event: EventRecord;
  appBaseUrl: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: ProposalSpeakerRole;
}

async function inviteProposalSpeakerOnce(
  db: DatabaseLike,
  payload: ProposalSpeakerInvitation,
): Promise<{ email: string; outboxId: string }> {
  if (!isProposalSpeakerRosterEditableStatus(payload.proposal.status)) {
    throw new AppError(409, "PROPOSAL_CLOSED", "Cannot invite speakers to a closed proposal");
  }

  const preparedUser = await buildFindOrCreateUserStatement(db, {
    email: payload.email,
    firstName: payload.firstName,
    lastName: payload.lastName,
  });
  const preparedSpeaker = await buildAddProposalSpeaker(db, {
    proposalId: payload.proposal.id,
    userId: preparedUser.user.id,
    role: payload.role,
    proposalContext: {
      event_id: payload.proposal.event_id,
      status: payload.proposal.status,
      updated_at: payload.proposal.updated_at,
    },
  });
  const speakerWrite = preparedSpeaker.statements[0];
  if (!speakerWrite) throw new Error("Proposal speaker write statement was not prepared");
  const capacityStatements = preparedSpeaker.statements.slice(1);
  const context = await buildProposalInviteEmailContext(db, {
    proposalId: payload.proposal.id,
    inviterUserId: payload.proposal.proposer_user_id,
  });
  const pendingLine = `- ${formatInvitePerson(
    preparedUser.user.first_name,
    preparedUser.user.last_name,
    preparedUser.user.organization_name,
    preparedUser.user.email,
  )}`;
  const speakerLineupText = preparedSpeaker.alreadyPresent
    ? context.speakerLineupText
    : [context.speakerLineupText, pendingLine].filter(Boolean).join("\n");
  const inviteEmailText = proposalInviteEmailTextVariables({ ...context, speakerLineupText });
  const manageUrl = speakerManagePageUrl(payload.appBaseUrl, payload.event, preparedSpeaker.manageToken);
  const idempotencyKey = `proposal_speaker_invite:${preparedSpeaker.speakerId}:${preparedSpeaker.inviteGeneration}`;
  const queued = prepareQueueEmailStatement(db, {
    outboxId: (await sha256Hex(idempotencyKey)).slice(0, 32),
    idempotencyKey,
    eventId: payload.event.id,
    baseUrl: payload.appBaseUrl,
    templateKey: "co_speaker_invite",
    recipientEmail: preparedUser.user.email,
    recipientUserId: preparedUser.user.id,
    messageType: "transactional",
    subject: `You have been added as a speaker — ${payload.event.name}`,
    capabilityLinkValues: [manageUrl],
    data: {
      ...buildEventEmailVariables(payload.event, payload.appBaseUrl),
      proposalId: payload.proposal.id,
      speakerUserId: preparedUser.user.id,
      firstName: emailPlainText(preparedUser.user.first_name ?? ""),
      lastName: emailPlainText(preparedUser.user.last_name ?? ""),
      ...inviteEmailText,
      manageUrl,
    },
  });

  const statements: StatementLike[] = [];
  if (preparedUser.statement) statements.push(preparedUser.statement);
  statements.push(
    speakerWrite,
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "proposal", id: payload.proposal.id },
      "user",
      payload.proposal.proposer_user_id,
      "co_speaker_invited",
      "proposal_speaker",
      preparedSpeaker.speakerId,
      {
        proposalId: payload.proposal.id,
        speakerUserId: preparedUser.user.id,
        email: preparedUser.user.email,
        role: payload.role,
      },
      undefined,
      idempotencyKey,
    ),
    ...capacityStatements,
    queued.statement,
  );
  try {
    await db.batch(statements);
  } catch (error) {
    if (isRegistrationTransitionConflict(error)) throw registrationChangedError();
    if (isEventParticipantSourceConflict(error)) throw eventParticipantSourceConflictError();
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "PROPOSAL_CHANGED", "Proposal changed while the speaker was being invited");
    }
    throw error;
  }
  return { email: preparedUser.user.email, outboxId: queued.id };
}

export async function inviteProposalSpeaker(
  db: DatabaseLike,
  payload: ProposalSpeakerInvitation,
): Promise<{ email: string; outboxId: string }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await inviteProposalSpeakerOnce(db, payload);
    } catch (error) {
      const concurrentUserInsert =
        error instanceof Error && error.message.includes("UNIQUE constraint failed: users.normalized_email");
      if (!concurrentUserInsert || attempt === 2) throw error;
    }
  }
  throw new Error("Speaker invitation could not be committed after concurrent user creation");
}
