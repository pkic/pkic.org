import { userAuditLogRouteSchema } from "../../../../../assets/shared/schemas/user-management";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { readUserAuditLogRequest } from "../../../../_lib/services/audit-log-read";

export const UserAuditLogGet = openApiRoute(userAuditLogRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  return json(await readUserAuditLogRequest(requestDb(c), c.req.raw, c.env, data.params.userId, data.query));
});
