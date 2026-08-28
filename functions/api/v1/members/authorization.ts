import type { Permission } from "../../../../assets/shared/schemas/permissions";
import { requireUserBackedAdminFromRequest } from "../../../_lib/auth/admin";
import { requirePermission } from "../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../_lib/db/context";

/** Resolves an attributable staff identity for canonical membership routes. */
export async function requireMembershipStaffPermission(c: AdminContext, permission: Permission) {
  const db = requestDb(c);
  const staff = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(staff, permission);
  return { db, staff };
}
