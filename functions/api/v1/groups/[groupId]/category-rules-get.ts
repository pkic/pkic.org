import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getGroupCategoryRules } from "../../../../_lib/services/groups";
import { groupCategoryRulesGetRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-groups";
import { requireGroupManagementActor, requireGroupResourceContext } from "../group-resource-context";

export const GroupCategoryRulesGet = openApiRoute(groupCategoryRulesGetRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  requireGroupManagementActor(context);
  return json(await getGroupCategoryRules(db, context.group));
});
