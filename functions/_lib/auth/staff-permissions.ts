import type { Permission } from "../../../assets/shared/schemas/permissions";
import { requireUserBackedAdminFromRequest } from "./admin";
import { requireAnyPermission, requirePermission } from "./permissions";
import { requestDb, type AdminContext } from "../db/context";

/** Resolve one attributable staff identity and enforce an exact global permission. */
export async function requireStaffPermission(c: AdminContext, permission: Permission) {
  const db = requestDb(c);
  const staff = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(staff, permission);
  return { db, staff };
}

/** Resolve one attributable staff identity and enforce at least one global permission. */
export async function requireStaffAnyPermission(c: AdminContext, permissions: readonly Permission[]) {
  if (permissions.length === 0) {
    throw new Error("Staff authorization requires at least one permission");
  }
  const db = requestDb(c);
  const staff = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  requireAnyPermission(staff, permissions);
  return { db, staff };
}
