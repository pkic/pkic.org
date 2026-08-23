import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { getAdminPlatformStats } from "../../../_lib/services/admin-platform-stats";
import { adminStatsResponseSchema, adminStatsRouteSchema } from "../../../../assets/shared/schemas/admin-analytics";

export const AdminStatsGet = openApiRoute(adminStatsRouteSchema, async (c: AdminContext) => {
  const db = requestDb(c);
  await requireAdminFromRequest(db, c.req.raw, c.env);
  return json(adminStatsResponseSchema.parse(await getAdminPlatformStats(db)));
});
