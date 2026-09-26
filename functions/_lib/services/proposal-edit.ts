import type { z } from "zod";
import type { proposalEditableSchema, proposalPatchSchema } from "../../../assets/shared/schemas/proposal-management";
import { getProposalAccessForEvent } from "../auth/proposal-access";
import { preparePermissionsAuthorizationGuard, type Permission } from "../auth/permissions";
import { isAuthorizationGuardFailure } from "../db/authorization-guard";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike } from "../types";
import { nowIso } from "../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";
import { withProposalWriteContextGuard, type ProposalWriteAuthorization } from "./proposal-write-authorization";

type ProposalPatch = z.infer<typeof proposalPatchSchema>;
type EditableProposal = z.infer<typeof proposalEditableSchema>;

interface EditableProposalWithEvent extends EditableProposal {
  event_id: string;
  status: string;
}

/**
 * Correct a proposal title or abstract. Accepted abstracts may be corrected by
 * the narrow `proposals:edit_accepted_abstract` capability; titles still need
 * `proposals:manage` because they change the accepted program.
 */
export async function editProposal(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  patch: ProposalPatch,
  authorization?: ProposalWriteAuthorization,
): Promise<EditableProposal> {
  const current = await first<EditableProposalWithEvent>(
    db,
    `SELECT id, event_id, status, title, abstract, updated_at
     FROM session_proposals
     WHERE id = ? AND deleted_at IS NULL`,
    [proposalId],
  );
  if (!current) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");

  const access = await getProposalAccessForEvent(db, current.event_id, actor);
  const accepted = current.status === "accepted";
  const requiredPermissions: Permission[] = accepted
    ? [
        ...(patch.title !== undefined ? (["proposals:manage"] as const) : []),
        ...(patch.abstract !== undefined ? (["proposals:edit_accepted_abstract"] as const) : []),
      ]
    : ["proposals:manage"];
  if (
    (!accepted && !access.canFinalize) ||
    (accepted && patch.title !== undefined && !access.canFinalize) ||
    (accepted && patch.abstract !== undefined && !access.canEditAcceptedAbstract)
  ) {
    throw new AppError(403, "FORBIDDEN", "Missing permission to edit the requested proposal fields");
  }

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
  try {
    await db.batch(
      withProposalWriteContextGuard(authorization, [
        preparePermissionsAuthorizationGuard(db, actor, [
          ...requiredPermissions.map((permission) => ({
            permission,
            context: { type: "event", id: current.event_id },
          })),
        ]),
        db
          .prepare(
            `UPDATE session_proposals
             SET title = ?, abstract = ?, updated_at = ?
             WHERE id = ? AND event_id = ? AND status = ? AND title = ? AND abstract = ?
               AND updated_at = ? AND deleted_at IS NULL`,
          )
          .bind(
            next.title,
            next.abstract,
            next.updated_at,
            current.id,
            current.event_id,
            current.status,
            current.title,
            current.abstract,
            current.updated_at,
          ),
        prepareAuditLogAfterOneChange(
          db,
          "admin",
          actor.id,
          "proposal_edited",
          "proposal",
          current.id,
          changes,
          next.updated_at,
          { type: "event", id: current.event_id },
        ),
      ]),
    );
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "PROPOSAL_AUTHORIZATION_CHANGED",
        "Proposal editing permission changed while the update was being saved",
      );
    }
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "PROPOSAL_EDIT_CONFLICT", "Proposal changed while the update was being saved");
    }
    throw error;
  }
  return next;
}
