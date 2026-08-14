/**
 * GET /api/v1/me/applications — my application history.
 */
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { listMyApplications } from "../../../../_lib/services/member-self-service";
import { myApplicationsListRouteSchema } from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const MeApplicationsGet = openApiRoute(myApplicationsListRouteSchema, async (c: AdminContext) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const applications = await listMyApplications(db, member);
  return json({ applications });
});
