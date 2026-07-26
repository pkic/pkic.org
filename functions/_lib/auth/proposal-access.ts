import { hasPermission } from "./permissions";
import type { AuthAdmin, DatabaseLike } from "../types";

export interface ProposalAccess {
  eventPermissions: string[];
  canReview: boolean;
  canFinalize: boolean;
}

/**
 * Resolve proposal moderation capabilities for a user on a specific event.
 *
 * Backed by Phase 2 (PRD §2) `user_roles`/`permission_grants` via
 * `hasPermission`, not the dropped `event_permissions` table (see migration
 * 0035 §0.2). `proposals:score` (program_committee, event_moderator)
 * grants review; `proposals:manage` (event_organizer, program_committee)
 * grants finalize — matching the old REVIEW_PERMISSIONS/FINALIZE_PERMISSIONS
 * sets those roles were backfilled from. Global admins keep full access via
 * hasPermission's built-in role='admin' bypass.
 */
export async function getProposalAccessForEvent(
  _db: DatabaseLike,
  eventId: string,
  actor: AuthAdmin,
): Promise<ProposalAccess> {
  const context = { type: "event", id: eventId };
  const eventPermissions = (actor.grants ?? [])
    .filter((grant) => grant.contextType === context.type && grant.contextId === context.id)
    .map((grant) => grant.permission);

  return {
    eventPermissions,
    canReview: hasPermission(actor, "proposals:score", context) || hasPermission(actor, "proposals:manage", context),
    canFinalize: hasPermission(actor, "proposals:manage", context),
  };
}
