/**
 * GET /api/v1/me/applications — my application history.
 */
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { listMyApplications } from "../../../../_lib/services/member-self-service";
import { myApplicationsListRouteSchema } from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";

export const MeApplicationsGet = openApiRoute(myApplicationsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const { limit = 25, offset = 0, q, sort } = data.query;
  const result = await listMyApplications(db, member, { limit, offset, q, sort });
  return json({
    applications: result.applications,
    page: buildPageInfo(limit, offset, result.total, result.applications.length),
  });
});
