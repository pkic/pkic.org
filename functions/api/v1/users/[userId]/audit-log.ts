import { userAuditLogRouteSchema } from "../../../../../assets/shared/schemas/user-management";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { listUserAuditLog } from "../../../../_lib/services/audit-log-read";
import { requireUserStaffPermission } from "../authorization";

export const UserAuditLogGet = openApiRoute(userAuditLogRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db } = await requireUserStaffPermission(c, "users:read");
  return json(await listUserAuditLog(db, data.params.userId, data.query));
});
