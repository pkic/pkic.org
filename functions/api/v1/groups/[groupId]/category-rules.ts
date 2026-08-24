import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { replaceGroupCategoryRules } from "../../../../_lib/services/groups";
import { groupCategoryRulesReplaceRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-groups";

export const GroupCategoryRulesReplace = openApiRoute(
  groupCategoryRulesReplaceRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    await replaceGroupCategoryRules(db, admin, data.params.groupId, data.body);
    return json({ success: true });
  },
);
