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
 * Backed by `user_roles`/`permission_grants` via
 * `hasPermission`, not the dropped `event_permissions` table (see migration
 * 0035). `proposals:score` (program_committee, event_moderator)
 * grants review; `proposals:manage` (event_organizer, program_committee)
 * grants finalize. These are separate capabilities: custom roles must
 * explicitly receive `proposals:score` to author reviews. Seeded roles retain
 * both permissions, matching the old REVIEW_PERMISSIONS/FINALIZE_PERMISSIONS
 * sets. Global admins keep full access via hasPermission's role bypass.
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
    canReview: hasPermission(actor, "proposals:score", context),
    canFinalize: hasPermission(actor, "proposals:manage", context),
  };
}
