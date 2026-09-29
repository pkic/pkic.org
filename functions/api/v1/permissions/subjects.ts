import { permissionSubjectsListRouteSchema } from "../../../../assets/shared/schemas/access-control";
import type { AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listUserCatalog } from "../../../_lib/services/user-catalog";
import { requireStaffAnyPermission } from "../../../_lib/auth/staff-permissions";

/** Data-minimized active identities eligible to receive permission assignments. */
export const PermissionSubjectsList = openApiRoute(permissionSubjectsListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireStaffAnyPermission(c, ["access:grant", "access:revoke"]);
  return json(await listUserCatalog(db, data.query));
});
