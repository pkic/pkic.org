/**
 * GET /api/v1/admin/vote-proposals/:id — proposal detail + endorsers.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { getProposalScopeForPermissionCheck, getVoteProposalDetail } from "../../../../../_lib/services/votes";
import { adminProposalDetailRouteSchema } from "../../../../../../assets/shared/schemas/votes-admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const AdminVoteProposalGet = openApiRoute(adminProposalDetailRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const id = data.params.id;

  const scope = await getProposalScopeForPermissionCheck(db, id);
  requirePermission(
    admin,
    "votes:manage",
    scope.scopeType === "working_group" && scope.scopeId ? { type: "working_group", id: scope.scopeId } : undefined,
  );

  const result = await getVoteProposalDetail(db, id);
  return json(result);
});
