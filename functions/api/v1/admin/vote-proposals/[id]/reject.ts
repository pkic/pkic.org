/**
 * POST /api/v1/admin/vote-proposals/:id/reject — reject a proposal with a
 * reason; notifies the proposer via `vote-proposal-rejected`.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { queueEmail, processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { getProposalScopeForPermissionCheck, rejectVoteProposal } from "../../../../../_lib/services/votes";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { adminRejectProposalRouteSchema } from "../../../../../../assets/shared/schemas/votes";
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
    const result = await rejectVoteProposal(db, id, body.reason);

    if (result.proposerEmail) {
      const outboxId = await queueEmail(db, {
        templateKey: "vote-proposal-rejected",
        recipientEmail: result.proposerEmail,
        messageType: "transactional",
        subject: `Your vote proposal was not approved: ${result.proposal.title}`,
        data: { proposerName: result.proposerName, proposalTitle: result.proposal.title, rejectionReason: body.reason },
      });
      c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));
    }

    await writeAuditLog(db, "admin", admin.id, "vote_proposal_rejected", "vote_proposal", id, { reason: body.reason });

    return json({ proposal: result.proposal });
  },
);
