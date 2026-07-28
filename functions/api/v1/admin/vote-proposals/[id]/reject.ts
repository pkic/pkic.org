/**
 * POST /api/v1/admin/vote-proposals/:id/reject — reject a proposal with a
 * reason; notifies the proposer via `vote-proposal-rejected` (PRD §4.8/§7).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { parseJsonBody } from "../../../../../_lib/validation";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { queueEmail, processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { getProposalScopeForPermissionCheck, rejectVoteProposal } from "../../../../../_lib/services/votes";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import {
  adminRejectProposalSchema,
  adminRejectProposalRouteSchema,
} from "../../../../../../assets/shared/schemas/votes";
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

  const body = await parseJsonBody(c.req, adminRejectProposalSchema);
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
}

export class AdminVoteProposalRejectPost extends OpenAPIRoute {
  schema = adminRejectProposalRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
