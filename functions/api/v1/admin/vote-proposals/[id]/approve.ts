/**
 * POST /api/v1/admin/vote-proposals/:id/approve — convert a proposal to an
 * active vote, bypassing the endorsement count.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requireEffectiveGroupPermission } from "../../../../../_lib/services/groups/governance";
import { approveVoteProposal, getProposalGroupForPermissionCheck } from "../../../../../_lib/services/votes";
import {
  adminApproveProposalRouteSchema,
  adminVoteProposalApproveResponseSchema,
} from "../../../../../../assets/shared/schemas/votes-admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const AdminVoteProposalApprovePost = openApiRoute(
  adminApproveProposalRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    const id = data.params.id;

    const ownerGroupId = await getProposalGroupForPermissionCheck(db, id);
    await requireEffectiveGroupPermission(db, admin, ownerGroupId, "votes:manage");

    const result = await approveVoteProposal(db, admin, id);

    return json(adminVoteProposalApproveResponseSchema.parse(result));
  },
);
