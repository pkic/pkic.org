import type { Permission } from "../../../../assets/shared/schemas/permissions";
import { requireUserBackedAdminFromRequest } from "../../../_lib/auth/admin";
import { requireAnyPermission, requirePermission } from "../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../_lib/db/context";

/** Resolve one attributable staff identity and enforce an exact global permission. */
export async function requireSystemPermission(c: AdminContext, permission: Permission) {
  const db = requestDb(c);
  const staff = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(staff, permission);
  return { db, staff };
}

/** Resolve one attributable staff identity and enforce at least one global System permission. */
export async function requireSystemAnyPermission(c: AdminContext, permissions: readonly Permission[]) {
  if (permissions.length === 0) {
    throw new Error("System authorization requires at least one permission");
  }
  const db = requestDb(c);
  const staff = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  requireAnyPermission(staff, permissions);
  return { db, staff };
}
