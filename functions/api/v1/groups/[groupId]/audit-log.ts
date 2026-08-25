import { scopedAuditLogResponseSchema } from "../../../../../assets/shared/schemas/audit-log";
import { groupAuditLogListRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-groups";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { listGroupAuditLog } from "../../../../_lib/services/groups";

export const GroupAuditLogList = openApiRoute(groupAuditLogListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
  return json(scopedAuditLogResponseSchema.parse(await listGroupAuditLog(db, actor, data.params.groupId, data.query)));
});
