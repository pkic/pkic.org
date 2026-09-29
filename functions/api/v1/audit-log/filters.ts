import { auditFilterOptionsRouteSchema } from "../../../../assets/shared/schemas/audit-filter-options";
import { requireStaffPermission } from "../../../_lib/auth/staff-permissions";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listAuditFilterOptions } from "../../../_lib/services/audit-filter-options";

export const AuditFilterOptions = openApiRoute(
  auditFilterOptionsRouteSchema,
  async (c: AdminContext, data) => json(await listAuditFilterOptions(requestDb(c), data.query)),
  async (c: AdminContext) => {
    await requireStaffPermission(c, "audit:read");
  },
);
