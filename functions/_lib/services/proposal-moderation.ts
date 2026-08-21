import type { ProposalFlagAction } from "../../../assets/shared/schemas/proposal-status";
import { isProposalDecisionStatus } from "../../../assets/shared/schemas/proposal-status";
import { getProposalAccessForEvent } from "../auth/proposal-access";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../types";
import { nowIso } from "../utils/time";
import { prepareAuditLogWhen } from "./audit";

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
  const conditionSql =
    action === "delete"
      ? "SELECT 1 FROM session_proposals WHERE id = ? AND status = ? AND updated_at = ? AND deleted_at = ? AND changes() = 1"
      : "SELECT 1 FROM session_proposals WHERE id = ? AND status = ? AND updated_at = ? AND deleted_at IS NULL AND changes() = 1";
  const conditionBindings =
    action === "delete" ? [proposal.id, targetStatus, now, now] : [proposal.id, targetStatus, now];
  const statements: StatementLike[] = [
    update,
    prepareAuditLogWhen(db, {
      actorType: "admin",
      actorId: actor.id,
      action: action === "delete" ? "proposal_deleted" : "proposal_flagged",
      entityType: "proposal",
      entityId: proposal.id,
      details: { status: { from: proposal.status, to: targetStatus } },
      createdAt: now,
      conditionSql,
      conditionBindings,
    }),
  ];
  if (action === "delete") {
    statements.push(
      db
        .prepare(
          `UPDATE event_participants
           SET status = 'inactive', updated_at = ?
           WHERE source_type = 'proposal' AND source_ref = ?
             AND EXISTS (
               SELECT 1 FROM session_proposals
               WHERE id = ? AND status = 'deleted' AND deleted_at = ? AND updated_at = ? AND changes() = 1
             )`,
        )
        .bind(now, proposal.id, proposal.id, now, now),
    );
  }

  const [updated] = await db.batch(statements);
  if ((updated.meta?.changes ?? 0) !== 1) throw await moderationConflict(db, proposal.id);
  return { action };
}
