import type { Permission } from "../../../../assets/shared/schemas/permissions";
import { requireUserBackedAdminFromRequest } from "../../../_lib/auth/admin";
import { guardMemberSessionMutationDatabase, requireMemberFromRequest } from "../../../_lib/auth/member";
import { AppError } from "../../../_lib/errors";
import { requirePermission } from "../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import type { AuthMember } from "../../../_lib/types";

/** Resolves an attributable staff identity for a canonical organization route. */
export async function requireOrganizationStaffPermission(c: AdminContext, permission: Permission) {
  const db = requestDb(c);
  const staff = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(staff, permission);
  return { db, staff };
}

/**
 * Resolves the caller's membership capacity FOR THE REQUESTED organization —
 * any organization the caller actively represents, not only the one
 * currently selected as their acting capacity (`member.organizationId`,
 * switched via `PUT /api/v1/users/current/memberships/active`). Organization
 * self-service is authorized by representation, not by acting capacity: a
 * user representing several organizations must reach each one's workspace
 * without switching.
 *
 * `activeMemberships` is a live, per-request D1 projection resolved by
 * `resolveUserSessionFromRequest` on every request (never cached JWT
 * authority), so matching against it here is exactly as authoritative as the
 * acting capacity comparison it replaces. A caller with no active capacity
 * for this organization gets the same 404 as one for a nonexistent
 * organization — no existence oracle.
 *
 * The returned `member` carries the memberId/organizationId/category for the
 * REQUESTED organization, not the acting one, so every downstream service
 * (audit attribution, contact-role checks, mutation-guard re-verification)
 * is bound to the organization the caller is actually acting on.
 */
export async function requireOrganizationMember(c: AdminContext, organizationId: string) {
  const db = requestDb(c);
  const actingMember = await requireMemberFromRequest(db, c.req.raw, c.env);
  const capacity = actingMember.activeMemberships.find((membership) => membership.organizationId === organizationId);
  if (!capacity) {
    throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found for the active membership");
  }
  const member: AuthMember =
    capacity.memberId === actingMember.memberId
      ? actingMember
      : {
          ...actingMember,
          memberId: capacity.memberId,
          organizationId: capacity.organizationId,
          membershipCategory: capacity.membershipCategory,
        };
  return { db, member };
}

/** Same organization binding, with exact session and membership guards on every mutation batch. */
export async function requireOrganizationMemberMutation(c: AdminContext, organizationId: string) {
  const { db, member } = await requireOrganizationMember(c, organizationId);
  return { db: guardMemberSessionMutationDatabase(db, member), member };
}
