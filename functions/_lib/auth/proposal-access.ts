import { all } from "../db/queries";
import { normalizeEmail } from "../validation";
import type { AuthAdmin, DatabaseLike } from "../types";

const REVIEW_PERMISSIONS = new Set(["organizer", "program_committee", "moderator"]);
const FINALIZE_PERMISSIONS = new Set(["organizer"]);

export interface ProposalAccess {
  eventPermissions: string[];
  canReview: boolean;
  canFinalize: boolean;
}

/**
 * Resolve proposal moderation capabilities for a user on a specific event.
 * Global admins keep full access; event permissions are still returned for UI hints.
 */
export async function getProposalAccessForEvent(
  db: DatabaseLike,
  eventId: string,
  actor: AuthAdmin,
): Promise<ProposalAccess> {
  const normalizedEmail = normalizeEmail(actor.email);
  const permissionRows = await all<{ permission: string }>(
    db,
    `SELECT permission
     FROM event_permissions
     WHERE event_id = ?
       AND (user_id = ? OR user_email = ?)
     ORDER BY permission ASC`,
    [eventId, actor.id, normalizedEmail],
  );

  const eventPermissions = permissionRows.map((row) => row.permission);
  const permissionSet = new Set(eventPermissions);

  const hasReviewPermission = eventPermissions.some((permission) => REVIEW_PERMISSIONS.has(permission));
  const hasFinalizePermission = eventPermissions.some((permission) => FINALIZE_PERMISSIONS.has(permission));

  return {
    eventPermissions,
    canReview: actor.role === "admin" || hasReviewPermission,
    canFinalize: actor.role === "admin" || hasFinalizePermission,
  };
}
