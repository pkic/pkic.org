import type { Permission } from "./permissions";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Canonical permission for a route in the proposal management subtree. */
export function proposalPermissionForRequest(path: string, method: string): Permission {
  const normalizedMethod = method.toUpperCase();
  if (/\/(?:audit-log|reviews|comments)(?:\/|$)/.test(path)) {
    return "proposals:score";
  }
  if (!WRITE_METHODS.has(normalizedMethod)) return "proposals:read";
  return "proposals:manage";
}

/** Resolve the event authorization scope for a proposal subtree request. */
export async function getProposalEventScope(db: DatabaseLike, proposalId: string): Promise<string> {
  const proposal = await first<{ event_id: string }>(
    db,
    "SELECT event_id FROM session_proposals WHERE id = ? AND deleted_at IS NULL",
    [proposalId],
  );
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  return proposal.event_id;
}
