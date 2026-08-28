import { json } from "../../../../_lib/http";
import { listLeadershipAffiliations } from "../../../../_lib/services/leadership-affiliations";
import { leadershipAffiliationsRouteSchema } from "../../../../../assets/shared/schemas/leadership";
import type { AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { requireStaffAnyPermission } from "../../../../_lib/auth/staff-permissions";

export const LeadershipAffiliationsList = openApiRoute(
  leadershipAffiliationsRouteSchema,
  async (c: AdminContext, data) => {
    const { db } = await requireStaffAnyPermission(c, ["access:grant", "access:revoke"]);

    return json({ affiliations: await listLeadershipAffiliations(db, data.params.userId) });
  },
);
