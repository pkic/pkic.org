/**
 * POST /api/v1/admin/vote-proposals/:id/reject — reject a proposal with a
 * reason; notifies the proposer via `vote-proposal-rejected`.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { getProposalScopeForPermissionCheck, rejectVoteProposal } from "../../../../../_lib/services/votes";
import {
  adminRejectProposalRouteSchema,
  adminVoteProposalRejectResponseSchema,
} from "../../../../../../assets/shared/schemas/votes-admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const AdminVoteProposalRejectPost = openApiRoute(
  adminRejectProposalRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    const id = data.params.id;

    const scope = await getProposalScopeForPermissionCheck(db, id);
    requirePermission(
      admin,
      "votes:manage",
      scope.scopeType === "working_group" && scope.scopeId ? { type: "working_group", id: scope.scopeId } : undefined,
    );

    const body = data.body;
    const result = await rejectVoteProposal(db, admin, id, body.reason);

    if (result.outboxId) {
      c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));
    }

    return json(adminVoteProposalRejectResponseSchema.parse({ proposal: result.proposal }));
  },
);
