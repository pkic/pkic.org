import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { listLeadershipAffiliations } from "../../../../_lib/services/leadership-affiliations";
import { leadershipAffiliationsRouteSchema } from "../../../../../assets/shared/schemas/leadership";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const LeadershipAffiliationsList = openApiRoute(
  leadershipAffiliationsRouteSchema,
  async (c: AdminContext, data) => {
    const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
    requirePermission(admin, "access:grant");

    return json({ affiliations: await listLeadershipAffiliations(requestDb(c), data.params.userId) });
  },
);
