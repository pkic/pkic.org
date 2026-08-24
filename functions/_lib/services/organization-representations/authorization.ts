import { REPRESENTATIVE_ROLE_IDS } from "../../../../assets/shared/schemas/representative-roles";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";

export async function requireOrganizationRepresentativeManagement(
  db: DatabaseLike,
  input: { memberId: string; actorUserId: string; staffAuthorized: boolean },
): Promise<void> {
  const member = await first<{ id: string }>(
    db,
    "SELECT id FROM members WHERE id = ? AND organization_id IS NOT NULL AND status = 'active'",
    [input.memberId],
  );
  if (!member) throw new AppError(404, "ORGANIZATION_MEMBERSHIP_NOT_FOUND", "Active organization membership not found");
  if (input.staffAuthorized) return;

  const contact = await first<{ authorized: number }>(
    db,
    `SELECT 1 AS authorized
       FROM user_roles role
       JOIN users actor ON actor.id = role.user_id AND actor.active = 1
       JOIN organization_representatives representative
         ON representative.member_id = role.context_id
        AND representative.user_id = role.user_id
        AND representative.left_at IS NULL
        AND representative.blocked_at IS NULL
      WHERE role.user_id = ?
        AND role.context_type = 'organization'
        AND role.context_id = ?
        AND role.role_id IN (?, ?)
        AND role.revoked_at IS NULL
        AND (role.expires_at IS NULL OR role.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      LIMIT 1`,
    [
      input.actorUserId,
      input.memberId,
      REPRESENTATIVE_ROLE_IDS.primaryContact,
      REPRESENTATIVE_ROLE_IDS.secondaryContact,
    ],
  );
  if (!contact) {
    throw new AppError(
      403,
      "ORGANIZATION_CONTACT_REQUIRED",
      "An active primary or secondary organization contact is required",
    );
  }
}

export async function resolveOrganizationMemberId(db: DatabaseLike, organizationId: string): Promise<string> {
  const member = await first<{ id: string }>(
    db,
    "SELECT id FROM members WHERE organization_id = ? AND status = 'active'",
    [organizationId],
  );
  if (!member) throw new AppError(404, "ORGANIZATION_MEMBERSHIP_NOT_FOUND", "Active organization membership not found");
  return member.id;
}
