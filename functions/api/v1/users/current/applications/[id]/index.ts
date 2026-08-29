import { json } from "../../../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../../../_lib/auth/member";
import { getMyApplicationDetail } from "../../../../../../_lib/services/member-self-service";
import { myApplicationDetailRouteSchema } from "../../../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../_lib/openapi/route";

export const CurrentUserApplicationGet = openApiRoute(myApplicationDetailRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const application = await getMyApplicationDetail(db, member, data.params.id);
  return json(application);
});
