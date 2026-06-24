import { run } from "../db/queries";
import { AppError } from "../errors";
import { nowIso } from "../utils/time";
import type { DatabaseLike } from "../types";

export async function markProposalStatus(
  db: DatabaseLike,
  payload: { proposalId: string; status: "spam" | "duplicate" },
): Promise<void> {
  const result = await run(
    db,
    "UPDATE session_proposals SET status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    [payload.status, nowIso(), payload.proposalId],
  );
  if (result.changes === 0) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found or already deleted");
}

export async function softDeleteProposal(db: DatabaseLike, payload: { proposalId: string }): Promise<void> {
  const now = nowIso();
  const result = await run(
    db,
    `UPDATE session_proposals
     SET status = 'deleted', deleted_at = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [now, now, payload.proposalId],
  );
  if (result.changes === 0) {
    throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found or already deleted");
  }

  await run(
    db,
    `UPDATE event_participants
     SET status = 'inactive', updated_at = ?
     WHERE source_type = 'proposal' AND source_ref = ?`,
    [now, payload.proposalId],
  );
}
