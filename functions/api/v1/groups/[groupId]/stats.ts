import { groupStatsResponseSchema, groupStatsRouteSchema } from "../../../../../assets/shared/schemas/group-statistics";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getGroupStatistics } from "../../../../_lib/services/groups";

export const GroupStatsGet = openApiRoute(groupStatsRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
  return json(groupStatsResponseSchema.parse(await getGroupStatistics(db, actor, data.params.groupId, data.query)));
});
