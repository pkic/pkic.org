import type { ProposalFlagAction } from "../../../assets/shared/schemas/proposal-status";
import { isProposalDecisionStatus } from "../../../assets/shared/schemas/proposal-status";
import { getProposalAccessForEvent } from "../auth/proposal-access";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../types";
import { nowIso } from "../utils/time";
import { isAuditOneChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";
import { prepareProposalRoleCapacityForProposalStatus } from "./proposal-role-capacity";
import { isRegistrationTransitionConflict, registrationChangedError } from "./registrations/transition-guard";
import { isEventParticipantSourceConflict } from "./event-participant-source-revision";
import { isProposalSpeakerRosterConflict } from "./proposal-speaker-roster-revision";

interface ModeratedProposal {
  id: string;
  event_id: string;
  status: string;
}

async function moderationConflict(db: DatabaseLike, proposalId: string): Promise<AppError> {
  const current = await first<{ status: string; deleted_at: string | null }>(
    db,
    "SELECT status, deleted_at FROM session_proposals WHERE id = ?",
    [proposalId],
  );
  if (!current || current.deleted_at) return new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  if (isProposalDecisionStatus(current.status)) {
    return new AppError(409, "PROPOSAL_ALREADY_FINALIZED", "Cannot flag or delete a finalized proposal");
  }
  return new AppError(409, "PROPOSAL_STATE_CHANGED", "Proposal changed while the moderation action was processed");
}

export async function moderateProposal(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  action: ProposalFlagAction,
): Promise<{ action: ProposalFlagAction }> {
  const proposal = await first<ModeratedProposal>(
    db,
    "SELECT id, event_id, status FROM session_proposals WHERE id = ? AND deleted_at IS NULL",
    [proposalId],
  );
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");

  const access = await getProposalAccessForEvent(db, proposal.event_id, actor);
  if (!access.canFinalize) throw new AppError(403, "FORBIDDEN", "Missing permission to flag proposals");
  if (isProposalDecisionStatus(proposal.status)) {
    throw new AppError(409, "PROPOSAL_ALREADY_FINALIZED", "Cannot flag or delete a finalized proposal");
  }
  if (proposal.status === action) return { action };

  const now = nowIso();
  const targetStatus = action === "delete" ? "deleted" : action;
  const update =
    action === "delete"
      ? db
          .prepare(
            `UPDATE session_proposals
             SET status = 'deleted', deleted_at = ?, updated_at = ?
             WHERE id = ? AND status = ? AND deleted_at IS NULL`,
          )
          .bind(now, now, proposal.id, proposal.status)
      : db
          .prepare(
            `UPDATE session_proposals
             SET status = ?, updated_at = ?
             WHERE id = ? AND status = ? AND deleted_at IS NULL`,
          )
          .bind(targetStatus, now, proposal.id, proposal.status);
  const statements: StatementLike[] = [
    update,
    prepareAuditLogAfterOneChange(
      db,
      "admin",
      actor.id,
      action === "delete" ? "proposal_deleted" : "proposal_flagged",
      "proposal",
      proposal.id,
      { status: { from: proposal.status, to: targetStatus } },
      now,
    ),
  ];
  if (action === "delete") {
    statements.push(
      ...(await prepareProposalRoleCapacityForProposalStatus(db, {
        eventId: proposal.event_id,
        sourceRef: proposal.id,
        nextStatus: "inactive",
      })),
    );
  }

  try {
    await db.batch(statements);
  } catch (error) {
    if (isRegistrationTransitionConflict(error)) throw registrationChangedError();
    if (
      isAuditOneChangeGuardFailure(error) ||
      isEventParticipantSourceConflict(error) ||
      isProposalSpeakerRosterConflict(error)
    ) {
      throw await moderationConflict(db, proposal.id);
    }
    throw error;
  }
  // The adjacent audit guard is the authoritative one-change check. D1's
  // statement metadata may instead reflect nested source-revision triggers.
  return { action };
}
