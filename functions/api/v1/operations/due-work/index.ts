import { resolveAppBaseUrl } from "../../../../_lib/config";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { listDueWork } from "../../../../_lib/services/due-work-read-model";
import { dueWorkListResponseSchema, dueWorkListRouteSchema } from "../../../../../assets/shared/schemas/operations";
import { requireStaffPermission } from "../../../../_lib/auth/staff-permissions";

export const DueWorkList = openApiRoute(dueWorkListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireStaffPermission(c, "operations:read");
  return json(
    dueWorkListResponseSchema.parse(await listDueWork(db, c.env, resolveAppBaseUrl(c.env, c.req.raw), data.query)),
  );
});
