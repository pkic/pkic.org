import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { replaceGroupCategoryRules } from "../../../../_lib/services/groups";
import { groupCategoryRulesReplaceRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-groups";
import { requireGroupManagementActor, requireGroupResourceContext } from "../group-resource-context";

export const GroupCategoryRulesReplace = openApiRoute(
  groupCategoryRulesReplaceRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const actor = requireGroupManagementActor(context);
    return json({ group: await replaceGroupCategoryRules(db, actor, context.group.id, data.body) });
  },
);
