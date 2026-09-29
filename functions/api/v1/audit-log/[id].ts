import { auditLogDetailResponseSchema, auditLogDetailRouteSchema } from "../../../../assets/shared/schemas/audit-log";
import { requireStaffPermission } from "../../../_lib/auth/staff-permissions";
import type { AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { getGlobalAuditLogEntry } from "../../../_lib/services/audit-log-read";

export const AuditLogDetailGet = openApiRoute(auditLogDetailRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireStaffPermission(c, "audit:read");
  return json(auditLogDetailResponseSchema.parse({ entry: await getGlobalAuditLogEntry(db, data.params.id) }));
});
