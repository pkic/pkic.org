import type { z } from "zod";
import type {
  adminProposalEditableSchema,
  adminProposalPatchSchema,
} from "../../../assets/shared/schemas/proposal-management";
import { getProposalAccessForEvent } from "../auth/proposal-access";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike } from "../types";
import { nowIso } from "../utils/time";
import { prepareAuditLogWhen } from "./audit";

type ProposalPatch = z.infer<typeof adminProposalPatchSchema>;
type EditableProposal = z.infer<typeof adminProposalEditableSchema>;

interface EditableProposalWithEvent extends EditableProposal {
  event_id: string;
}

export async function editAdminProposal(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  patch: ProposalPatch,
): Promise<EditableProposal> {
  const current = await first<EditableProposalWithEvent>(
    db,
    `SELECT id, event_id, title, abstract, updated_at
     FROM session_proposals
     WHERE id = ? AND deleted_at IS NULL`,
    [proposalId],
  );
  if (!current) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");

  const access = await getProposalAccessForEvent(db, current.event_id, actor);
  if (!access.canFinalize) throw new AppError(403, "FORBIDDEN", "Missing permission to edit proposals");

  const next = {
    id: current.id,
    title: patch.title ?? current.title,
    abstract: patch.abstract ?? current.abstract,
    updated_at: current.updated_at,
  };
  const changes: Record<string, { from: string; to: string }> = {};
  if (next.title !== current.title) changes.title = { from: current.title, to: next.title };
  if (next.abstract !== current.abstract) changes.abstract = { from: current.abstract, to: next.abstract };
  if (Object.keys(changes).length === 0) return next;

  next.updated_at = nowIso();
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE session_proposals
         SET title = ?, abstract = ?, updated_at = ?
         WHERE id = ? AND title = ? AND abstract = ? AND deleted_at IS NULL`,
      )
      .bind(next.title, next.abstract, next.updated_at, current.id, current.title, current.abstract),
    prepareAuditLogWhen(db, {
      actorType: "admin",
      actorId: actor.id,
      action: "proposal_edited",
      entityType: "proposal",
      entityId: current.id,
      details: changes,
      createdAt: next.updated_at,
      conditionSql:
        "SELECT 1 FROM session_proposals WHERE id = ? AND title = ? AND abstract = ? AND updated_at = ? AND deleted_at IS NULL AND changes() = 1",
      conditionBindings: [current.id, next.title, next.abstract, next.updated_at],
    }),
  ]);
  if ((updated.meta?.changes ?? 0) !== 1) {
    const exists = await first<{ id: string }>(
      db,
      "SELECT id FROM session_proposals WHERE id = ? AND deleted_at IS NULL",
      [current.id],
    );
    if (!exists) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
    throw new AppError(409, "PROPOSAL_EDIT_CONFLICT", "Proposal changed while the update was processed");
  }
  return next;
}
