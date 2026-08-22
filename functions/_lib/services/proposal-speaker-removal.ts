import {
  isEligibleReplacementProposerStatus,
  isProposalSpeakerRosterEditableStatus,
} from "../../../assets/shared/schemas/proposal-status";
import { getProposalAccessForEvent } from "../auth/proposal-access";
import { first } from "../db/queries";
import { prepareQueueEmailStatementWhen } from "../email/outbox";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../types";
import type { ProposalSpeakerRole } from "../../../assets/shared/schemas/participant-roles";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { newCapabilityLinkSecret, queuedCapabilityToken } from "./capability-links";
import {
  isAuditOneChangeGuardFailure,
  prepareAuditLogAfterOneChange,
  prepareScopedAuditLogAfterOneChange,
} from "./audit";
import { buildEventEmailVariables, getEventById } from "./events";
import { proposalManagePageUrl } from "./frontend-links";
import { prepareCancelProposalEmails } from "./proposal-email-cancellation";
import {
  prepareProposalRoleCapacityForSpeakerRemoval,
  prepareProposalRoleCapacityForSpeakerChange,
  proposalParticipantStatus,
} from "./proposal-role-capacity";
import { getProposalByManageToken } from "./proposals";
import { isRegistrationTransitionConflict, registrationChangedError } from "./registrations/transition-guard";
import { isEventParticipantSourceConflict } from "./event-participant-source-revision";
import { prepareStorageDeletion } from "./storage-deletion-outbox";

interface SpeakerRemovalContext {
  proposal_id: string;
  event_id: string;
  proposal_status: string;
  proposal_updated_at: string;
  proposer_user_id: string;
  proposal_title: string;
  speaker_count: number;
  speaker_id: string;
  speaker_user_id: string;
  speaker_role: ProposalSpeakerRole;
  speaker_status: string;
  headshot_override_set: number;
  headshot_override_r2_key: string | null;
}

interface ReplacementSpeaker {
  speaker_id: string;
  user_id: string;
  role: ProposalSpeakerRole;
  status: string;
  email: string;
  first_name: string | null;
}

export interface ProposalSpeakerRemovalResult {
  success: true;
  removedUserId: string;
  proposerUserId: string;
  cancelledEmailCount: number;
}

async function getSpeakerRemovalContext(
  db: DatabaseLike,
  proposalId: string,
  userId: string,
): Promise<SpeakerRemovalContext> {
  const context = await first<SpeakerRemovalContext>(
    db,
    `SELECT sp.id AS proposal_id, sp.event_id, sp.status AS proposal_status, sp.title AS proposal_title,
            sp.updated_at AS proposal_updated_at, sp.proposer_user_id,
            (SELECT COUNT(*) FROM proposal_speakers roster
             WHERE roster.proposal_id = sp.id AND roster.status <> 'declined') AS speaker_count,
            ps.id AS speaker_id, ps.user_id AS speaker_user_id,
            ps.role AS speaker_role, ps.status AS speaker_status,
            ps.headshot_override_set, ps.headshot_r2_key AS headshot_override_r2_key
     FROM session_proposals sp
     JOIN proposal_speakers ps ON ps.proposal_id = sp.id AND ps.user_id = ?
     WHERE sp.id = ? AND sp.deleted_at IS NULL`,
    [userId, proposalId],
  );
  if (context) return context;

  const proposal = await first<{ id: string }>(
    db,
    "SELECT id FROM session_proposals WHERE id = ? AND deleted_at IS NULL",
    [proposalId],
  );
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  throw new AppError(404, "SPEAKER_NOT_FOUND", "Speaker not found on this proposal");
}

async function getReplacementSpeaker(
  db: DatabaseLike,
  proposalId: string,
  userId: string,
): Promise<ReplacementSpeaker> {
  const replacement = await first<ReplacementSpeaker>(
    db,
    `SELECT ps.id AS speaker_id, ps.user_id, ps.role, ps.status, u.email, u.first_name
     FROM proposal_speakers ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.proposal_id = ? AND ps.user_id = ?`,
    [proposalId, userId],
  );
  if (!replacement) {
    throw new AppError(
      404,
      "REPLACEMENT_SPEAKER_NOT_FOUND",
      "The replacement proposer must already be a speaker on this proposal",
    );
  }
  if (!isEligibleReplacementProposerStatus(replacement.status)) {
    throw new AppError(
      409,
      "REPLACEMENT_PROPOSER_INELIGIBLE",
      "The replacement proposer must be an invited or confirmed speaker",
    );
  }
  return replacement;
}

function assertRemovalPolicy(
  context: SpeakerRemovalContext,
  replacementProposerUserId: string | undefined,
  allowProposerTransfer: boolean,
): void {
  if (!isProposalSpeakerRosterEditableStatus(context.proposal_status)) {
    throw new AppError(409, "PROPOSAL_CLOSED", "Speakers cannot be removed from a closed proposal");
  }
  const remainingNonDeclinedSpeakers = Number(context.speaker_count) - (context.speaker_status === "declined" ? 0 : 1);
  if (remainingNonDeclinedSpeakers < 1) {
    throw new AppError(
      409,
      "LAST_SPEAKER_REQUIRED",
      "A proposal must retain at least one speaker. Add a replacement speaker or withdraw the proposal instead.",
    );
  }
  const removesCurrentProposer = context.speaker_user_id === context.proposer_user_id;
  if (removesCurrentProposer && (!allowProposerTransfer || !replacementProposerUserId)) {
    throw new AppError(
      409,
      "PROPOSER_REPLACEMENT_REQUIRED",
      "Choose another existing speaker as the replacement proposer before removing the current proposer",
    );
  }
  if (!removesCurrentProposer && replacementProposerUserId) {
    throw new AppError(
      400,
      "REPLACEMENT_PROPOSER_NOT_ALLOWED",
      "A replacement proposer is only valid when removing the current proposer",
    );
  }
  if (replacementProposerUserId === context.speaker_user_id) {
    throw new AppError(400, "INVALID_REPLACEMENT_PROPOSER", "The removed speaker cannot replace themselves");
  }
}

async function throwSpeakerRemovalConflict(db: DatabaseLike, proposalId: string, userId: string): Promise<never> {
  const context = await getSpeakerRemovalContext(db, proposalId, userId);
  const remainingNonDeclinedSpeakers = Number(context.speaker_count) - (context.speaker_status === "declined" ? 0 : 1);
  if (remainingNonDeclinedSpeakers < 1) {
    throw new AppError(
      409,
      "LAST_SPEAKER_REQUIRED",
      "A proposal must retain at least one speaker. Add a replacement speaker or withdraw the proposal instead.",
    );
  }
  throw new AppError(409, "PROPOSAL_SPEAKER_CONFLICT", "The proposal speaker roster changed during removal");
}

async function removeProposalSpeaker(
  db: DatabaseLike,
  input: {
    context: SpeakerRemovalContext;
    actorType: "admin" | "user";
    actorId: string;
    actorEmail?: string;
    replacementProposerUserId?: string;
    allowProposerTransfer: boolean;
    appBaseUrl?: string;
  },
): Promise<ProposalSpeakerRemovalResult> {
  const { context } = input;
  assertRemovalPolicy(context, input.replacementProposerUserId, input.allowProposerTransfer);
  const replacement = input.replacementProposerUserId
    ? await getReplacementSpeaker(db, context.proposal_id, input.replacementProposerUserId)
    : null;
  const now = nowIso();
  const statements: StatementLike[] = [];

  if (replacement) {
    if (!input.appBaseUrl) throw new Error("Proposer transfer requires the application base URL");
    const event = await getEventById(db, context.event_id);
    const ownershipCondition = {
      sql: "SELECT 1 FROM session_proposals WHERE id = ? AND proposer_user_id = ? AND updated_at = ?",
      bindings: [context.proposal_id, replacement.user_id, now],
    };
    const manageUrl = proposalManagePageUrl(
      input.appBaseUrl,
      event,
      queuedCapabilityToken("proposal_manage", context.proposal_id),
    );
    const transferEmail = prepareQueueEmailStatementWhen(
      db,
      {
        outboxId: uuid(),
        idempotencyKey: `proposal_proposer_transfer:${context.proposal_id}:${uuid()}`,
        eventId: context.event_id,
        baseUrl: input.appBaseUrl,
        templateKey: "proposal_manage_link_transferred",
        recipientUserId: replacement.user_id,
        recipientEmail: replacement.email,
        subject: `You now manage proposal: ${context.proposal_title}`,
        messageType: "transactional",
        capabilityLinkValues: [manageUrl],
        data: {
          ...buildEventEmailVariables(event, input.appBaseUrl),
          firstName: replacement.first_name ?? "",
          proposalId: context.proposal_id,
          speakerUserId: replacement.user_id,
          proposalTitle: context.proposal_title,
          manageUrl,
        },
      },
      ownershipCondition,
      now,
    );
    statements.push(
      db
        .prepare(
          `UPDATE session_proposals
           SET proposer_user_id = ?, manage_link_secret = ?, updated_at = ?
           WHERE id = ? AND proposer_user_id = ? AND status = ? AND updated_at = ? AND deleted_at IS NULL
             AND EXISTS (
               SELECT 1 FROM proposal_speakers roster
               WHERE roster.proposal_id = session_proposals.id
                 AND roster.id <> ? AND roster.status <> 'declined'
             )
             AND EXISTS (
               SELECT 1 FROM proposal_speakers
               WHERE id = ? AND proposal_id = session_proposals.id AND user_id = ? AND role = ? AND status = ?
             )`,
        )
        .bind(
          replacement.user_id,
          newCapabilityLinkSecret(),
          now,
          context.proposal_id,
          context.proposer_user_id,
          context.proposal_status,
          context.proposal_updated_at,
          context.speaker_id,
          replacement.speaker_id,
          replacement.user_id,
          replacement.role,
          replacement.status,
        ),
      prepareAuditLogAfterOneChange(
        db,
        input.actorType,
        input.actorId,
        "proposal_proposer_transferred",
        "proposal",
        context.proposal_id,
        {
          proposerUserId: { from: context.proposer_user_id, to: replacement.user_id },
          replacementSpeakerId: { from: null, to: replacement.speaker_id },
          adminEmail: { from: null, to: input.actorEmail ?? null },
          manageCapability: { from: "active", to: "rotated" },
          replacementNotification: { from: null, to: "queued" },
        },
        now,
      ),
      transferEmail.statement,
    );
  }

  statements.push(
    db
      .prepare(
        `DELETE FROM proposal_speakers
         WHERE id = ? AND proposal_id = ? AND user_id = ? AND role = ? AND status = ?
           AND EXISTS (
             SELECT 1 FROM proposal_speakers roster
             WHERE roster.proposal_id = ? AND roster.id <> ? AND roster.status <> 'declined'
           )
           AND EXISTS (
             SELECT 1 FROM session_proposals
             WHERE id = ? AND status = ? AND deleted_at IS NULL
               AND proposer_user_id = ?
               AND updated_at = ?
           )`,
      )
      .bind(
        context.speaker_id,
        context.proposal_id,
        context.speaker_user_id,
        context.speaker_role,
        context.speaker_status,
        context.proposal_id,
        context.speaker_id,
        context.proposal_id,
        context.proposal_status,
        replacement?.user_id ?? context.proposer_user_id,
        replacement ? now : context.proposal_updated_at,
      ),
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "proposal", id: context.proposal_id },
      input.actorType,
      input.actorId,
      "proposal_speaker_removed",
      "proposal_speaker",
      context.speaker_id,
      {
        proposalId: { from: context.proposal_id, to: context.proposal_id },
        speakerUserId: { from: context.speaker_user_id, to: null },
        role: { from: context.speaker_role, to: null },
        status: { from: context.speaker_status, to: null },
        replacementProposerUserId: { from: null, to: replacement?.user_id ?? null },
        adminEmail: { from: null, to: input.actorEmail ?? null },
      },
      now,
    ),
    ...(context.headshot_override_set === 1 && context.headshot_override_r2_key
      ? [prepareStorageDeletion(db, context.headshot_override_r2_key, now)!]
      : []),
    ...(await prepareProposalRoleCapacityForSpeakerRemoval(db, {
      eventId: context.event_id,
      userId: context.speaker_user_id,
      sourceRef: context.proposal_id,
    })),
  );

  if (replacement) {
    statements.push(
      ...(await prepareProposalRoleCapacityForSpeakerChange(db, {
        eventId: context.event_id,
        userId: replacement.user_id,
        proposalRole: replacement.role,
        sourceRef: context.proposal_id,
        status: proposalParticipantStatus(context.proposal_status, replacement.status),
        sourceRevisionAdvance: 0,
      })),
    );
  }
  const cancelStatementIndex = statements.length;
  statements.push(
    prepareCancelProposalEmails(
      db,
      {
        proposalId: context.proposal_id,
        eventId: context.event_id,
        speakerId: context.speaker_id,
        speakerUserId: context.speaker_user_id,
        reason: "Cancelled because the proposal speaker was removed",
      },
      now,
    ),
  );

  try {
    const results = await db.batch(statements);
    return {
      success: true,
      removedUserId: context.speaker_user_id,
      proposerUserId: replacement?.user_id ?? context.proposer_user_id,
      cancelledEmailCount: Number(results[cancelStatementIndex]?.meta?.changes ?? 0),
    };
  } catch (error) {
    if (isRegistrationTransitionConflict(error)) {
      throw registrationChangedError();
    }
    if (isAuditOneChangeGuardFailure(error) || isEventParticipantSourceConflict(error)) {
      return throwSpeakerRemovalConflict(db, context.proposal_id, context.speaker_user_id);
    }
    throw error;
  }
}

export async function removeProposalSpeakerByProposer(
  db: DatabaseLike,
  input: { manageToken: string; signingSecret: string; userId: string },
): Promise<ProposalSpeakerRemovalResult> {
  const proposal = await getProposalByManageToken(db, input.manageToken, input.signingSecret);
  const context = await getSpeakerRemovalContext(db, proposal.id, input.userId);
  if (context.proposer_user_id !== proposal.proposer_user_id) {
    throw new AppError(409, "PROPOSAL_SPEAKER_CONFLICT", "Proposal ownership changed during removal");
  }
  return removeProposalSpeaker(db, {
    context,
    actorType: "user",
    actorId: proposal.proposer_user_id,
    allowProposerTransfer: false,
  });
}

export async function removeAdminProposalSpeaker(
  db: DatabaseLike,
  input: {
    actor: AuthAdmin;
    proposalId: string;
    userId: string;
    replacementProposerUserId?: string;
    appBaseUrl: string;
  },
): Promise<ProposalSpeakerRemovalResult> {
  const context = await getSpeakerRemovalContext(db, input.proposalId, input.userId);
  const access = await getProposalAccessForEvent(db, context.event_id, input.actor);
  if (!access.canFinalize) throw new AppError(403, "FORBIDDEN", "Missing permission to remove proposal speakers");
  return removeProposalSpeaker(db, {
    context,
    actorType: "admin",
    actorId: input.actor.id,
    actorEmail: input.actor.email,
    replacementProposerUserId: input.replacementProposerUserId,
    allowProposerTransfer: true,
    appBaseUrl: input.appBaseUrl,
  });
}
