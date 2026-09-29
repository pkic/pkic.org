import {
  permissionTargetsListResponseSchema,
  permissionTargetsListRouteSchema,
} from "../../../../assets/shared/schemas/access-control";
import type { AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listPermissionTargets } from "../../../_lib/services/access-control/catalogs";
import { requireStaffAnyPermission } from "../../../_lib/auth/staff-permissions";

/** Search durable resource targets that can scope a permission grant or role assignment. */
export const PermissionTargetsList = openApiRoute(permissionTargetsListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireStaffAnyPermission(c, ["access:grant", "access:revoke"]);
  return json(permissionTargetsListResponseSchema.parse(await listPermissionTargets(db, data.query)));
});
