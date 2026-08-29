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
  if (/\/speakers\/?$/.test(path) && normalizedMethod === "GET") return "proposals:score";
  if (/\/cancellations\/?$/.test(path) && normalizedMethod === "POST") return "proposals:cancel_accepted";
  if (!WRITE_METHODS.has(normalizedMethod)) return "proposals:read";
  return "proposals:manage";
}

/**
 * Runtime alternatives for proposal routes whose body/status determines the
 * exact least-privilege capability. The service still enforces the one
 * applicable permission after loading the proposal.
 */
export function proposalPermissionAlternativesForRequest(path: string, method: string): readonly Permission[] {
  if (method.toUpperCase() === "PATCH" && /\/api\/v1\/proposals\/[^/]+\/?$/.test(path)) {
    return ["proposals:manage", "proposals:edit_accepted_abstract"];
  }
  return [proposalPermissionForRequest(path, method)];
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
