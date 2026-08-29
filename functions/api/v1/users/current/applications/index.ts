import { json } from "../../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { listMyApplications } from "../../../../../_lib/services/member-self-service";
import {
  myApplicationsListResponseSchema,
  myApplicationsListRouteSchema,
} from "../../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";

export const CurrentUserApplicationsGet = openApiRoute(myApplicationsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const result = await listMyApplications(db, member, data.query);
  return json(
    myApplicationsListResponseSchema.parse({
      applications: result.applications,
      page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.applications.length),
    }),
  );
});
