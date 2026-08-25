/**
 * POST /api/v1/admin/vote-proposals/:id/approve — convert a proposal to an
 * active vote, bypassing the endorsement count.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { approveVoteProposal } from "../../../../../_lib/services/votes";
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

    const result = await approveVoteProposal(db, admin, id);

    return json(adminVoteProposalApproveResponseSchema.parse(result));
  },
);
