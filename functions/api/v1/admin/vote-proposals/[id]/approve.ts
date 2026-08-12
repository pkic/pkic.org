/**
 * POST /api/v1/admin/vote-proposals/:id/approve — convert a proposal to an
 * active vote, bypassing the endorsement count.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { approveVoteProposal, getProposalScopeForPermissionCheck } from "../../../../../_lib/services/votes";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { adminApproveProposalRouteSchema } from "../../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const id = c.req.param("id");

  const scope = await getProposalScopeForPermissionCheck(db, id);
  requirePermission(
    admin,
    "votes:manage",
    scope.scopeType === "working_group" && scope.scopeId ? { type: "working_group", id: scope.scopeId } : undefined,
  );

  const result = await approveVoteProposal(db, id);

  await writeAuditLog(db, "admin", admin.id, "vote_proposal_approved", "vote_proposal", id, {
    voteId: result.convertedVote.id,
  });

  return json(result);
}

export class AdminVoteProposalApprovePost extends OpenAPIRoute {
  schema = adminApproveProposalRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
