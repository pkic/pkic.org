import type { Permission } from "../../../../assets/shared/schemas/permissions";
import { requireUserBackedAdminFromRequest } from "../../../_lib/auth/admin";
import { guardMemberSessionMutationDatabase, requireMemberFromRequest } from "../../../_lib/auth/member";
import { AppError } from "../../../_lib/errors";
import { requirePermission } from "../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../_lib/db/context";

/** Resolves an attributable staff identity for a canonical organization route. */
export async function requireOrganizationStaffPermission(c: AdminContext, permission: Permission) {
  const db = requestDb(c);
  const staff = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(staff, permission);
  return { db, staff };
}

/** Resolves the caller's selected membership and binds it to the requested organization resource. */
export async function requireOrganizationMember(c: AdminContext, organizationId: string) {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  if (!member.organizationId || member.organizationId !== organizationId) {
    throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found for the active membership");
  }
  return { db, member };
}

/** Same organization binding, with exact session and membership guards on every mutation batch. */
export async function requireOrganizationMemberMutation(c: AdminContext, organizationId: string) {
  const { db, member } = await requireOrganizationMember(c, organizationId);
  return { db: guardMemberSessionMutationDatabase(db, member), member };
}
