/**
 * GET /api/v1/admin/vote-proposals/:id — proposal detail + endorsers
 * (PRD §4.8/§7).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { getProposalScopeForPermissionCheck, getVoteProposalDetail } from "../../../../../_lib/services/votes";
import { adminProposalDetailRouteSchema } from "../../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const id = c.req.param("id");

  const scope = await getProposalScopeForPermissionCheck(db, id);
  requirePermission(
    admin,
    "votes:manage",
    scope.scopeType === "working_group" && scope.scopeId ? { type: "working_group", id: scope.scopeId } : undefined,
  );

  const result = await getVoteProposalDetail(db, id);
  return json(result);
}

export class AdminVoteProposalGet extends OpenAPIRoute {
  schema = adminProposalDetailRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
