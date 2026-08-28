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
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import { AppError } from "../errors";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import { effectiveStoredInviteExpiry, eventInviteWindowEvidence, resolveEventInviteExpiry } from "../invite-validity";
import { isRegistrationTransitionConflict, registrationChangedError } from "./registrations/transition-guard";
import {
  eventParticipantSourceConflictError,
  isEventParticipantSourceConflict,
} from "./event-participant-source-revision";
import { withProposalWriteContextGuard, type ProposalWriteAuthorization } from "./proposal-write-authorization";
import { nowIso } from "../utils/time";
import { first } from "../db/queries";

class ConcurrentSpeakerInvitation extends Error {}

export interface ProposalSpeakerInvitation {
  proposal: ProposalRecord;
  event: EventRecord;
  appBaseUrl: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: ProposalSpeakerRole;
  expiresAt?: string;
  authorization?: ProposalWriteAuthorization;
  permissionGuard?: StatementLike;
  auditActor?: { type: "user" | "admin"; id: string };
}

async function inviteProposalSpeakerOnce(
  db: DatabaseLike,
  payload: ProposalSpeakerInvitation,
): Promise<{ email: string; outboxId: string; expiresAt: string; queued: boolean }> {
  if (!isProposalSpeakerRosterEditableStatus(payload.proposal.status)) {
    throw new AppError(409, "PROPOSAL_CLOSED", "Cannot invite speakers to a closed proposal");
  }

  const now = nowIso();
  const requestedExpiresAt = resolveEventInviteExpiry(payload.event, payload.expiresAt, now);
  const preparedUser = await buildFindOrCreateUserStatement(db, {
    email: payload.email,
    firstName: payload.firstName,
    lastName: payload.lastName,
  });
  const preparedSpeaker = await buildAddProposalSpeaker(db, {
    proposalId: payload.proposal.id,
    userId: preparedUser.user.id,
    role: payload.role,
    inviteExpiresAt: requestedExpiresAt,
    renewExpiredInvitation: { event: payload.event, now },
    proposalContext: {
      event_id: payload.proposal.event_id,
      status: payload.proposal.status,
      updated_at: payload.proposal.updated_at,
    },
  });
  if (preparedSpeaker.speakerStatements.length === 0) {
    throw new Error("Proposal speaker write statement was not prepared");
  }
  const expiresAt = effectiveStoredInviteExpiry(payload.event, preparedSpeaker.inviteExpiresAt);
  if (!expiresAt || Date.parse(expiresAt) <= Date.parse(now)) {
    throw new AppError(409, "SPEAKER_INVITATION_EXPIRED", "The existing speaker invitation has expired");
  }
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

  const actor = payload.auditActor ?? { type: "user" as const, id: payload.proposal.proposer_user_id };
  const statements: StatementLike[] = [
    ...(payload.permissionGuard ? [payload.permissionGuard] : []),
    prepareAuthorizationGuard(db, eventInviteWindowEvidence(payload.event.id, payload.event, expiresAt, now)),
  ];
  if (preparedUser.statement) statements.push(preparedUser.statement);
  statements.push(
    ...preparedSpeaker.speakerStatements,
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "proposal", id: payload.proposal.id },
      actor.type,
      actor.id,
      "co_speaker_invited",
      "proposal_speaker",
      preparedSpeaker.speakerId,
      {
        proposalId: payload.proposal.id,
        speakerUserId: preparedUser.user.id,
        email: preparedUser.user.email,
        role: payload.role,
        expiresAt,
      },
      undefined,
      idempotencyKey,
    ),
    ...preparedSpeaker.capacityStatements,
    queued.statement,
  );
  try {
    await db.batch(withProposalWriteContextGuard(payload.authorization, statements));
  } catch (error) {
    if (isRegistrationTransitionConflict(error)) throw registrationChangedError();
    if (isEventParticipantSourceConflict(error)) throw eventParticipantSourceConflictError();
    if (isAuthorizationGuardFailure(error) && !preparedSpeaker.alreadyPresent) {
      const concurrent = await first<{ role: ProposalSpeakerRole; status: string; invite_expires_at: string | null }>(
        db,
        `SELECT role, status, invite_expires_at
           FROM proposal_speakers
          WHERE proposal_id = ? AND user_id = ?`,
        [payload.proposal.id, preparedUser.user.id],
      );
      const concurrentExpiry = concurrent
        ? effectiveStoredInviteExpiry(payload.event, concurrent.invite_expires_at)
        : null;
      if (
        concurrent?.status === "invited" &&
        concurrent.role === payload.role &&
        concurrentExpiry !== null &&
        Date.parse(concurrentExpiry) > Date.parse(now)
      ) {
        throw new ConcurrentSpeakerInvitation();
      }
    }
    if (isAuditChangeGuardFailure(error) || isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "PROPOSAL_CHANGED", "Proposal changed while the speaker was being invited");
    }
    throw error;
  }
  return {
    email: preparedUser.user.email,
    outboxId: queued.id,
    expiresAt,
    queued: !preparedSpeaker.alreadyPresent || preparedSpeaker.renewedInvitation,
  };
}

export async function inviteProposalSpeaker(
  db: DatabaseLike,
  payload: ProposalSpeakerInvitation,
): Promise<{ email: string; outboxId: string; expiresAt: string; queued: boolean }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await inviteProposalSpeakerOnce(db, payload);
    } catch (error) {
      const concurrentUserInsert =
        error instanceof Error && error.message.includes("UNIQUE constraint failed: users.normalized_email");
      const concurrentSpeakerInsert = error instanceof ConcurrentSpeakerInvitation;
      if ((!concurrentUserInsert && !concurrentSpeakerInsert) || attempt === 2) {
        if (concurrentSpeakerInsert) {
          throw new AppError(409, "PROPOSAL_CHANGED", "Proposal changed while the speaker was being invited");
        }
        throw error;
      }
    }
  }
  throw new Error("Speaker invitation could not be committed after concurrent user creation");
}
