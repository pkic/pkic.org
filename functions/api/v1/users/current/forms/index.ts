import { currentUserFormsListResponseSchema } from "../../../../../../assets/shared/schemas/member-forms";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { currentUserFormsListRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-user-forms";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listOpenFormPlacementsForMember } from "../../../../../_lib/services/forms";

export const CurrentUserFormsGet = openApiRoute(currentUserFormsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const result = await listOpenFormPlacementsForMember(db, member.userId, data.query);
  return json(
    currentUserFormsListResponseSchema.parse({
      forms: result.forms,
      page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.forms.length),
    }),
  );
});
