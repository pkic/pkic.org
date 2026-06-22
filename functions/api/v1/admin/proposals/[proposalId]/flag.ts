/**
 * Admin: flag a proposal as spam/duplicate or soft-delete it.
 *
 * POST /api/v1/admin/proposals/:proposalId/flag
 * Body: { action: "spam" | "duplicate" | "delete" }
 *
 * Requires canFinalize permission.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../_lib/auth/proposal-access";
import { first } from "../../../../../_lib/db/queries";
import { markProposalStatus, softDeleteProposal } from "../../../../../_lib/services/proposals";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { parseJsonBody } from "../../../../../_lib/validation";
import { z } from "zod";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

const flagSchema = z.object({
  action: z.enum(["spam", "duplicate", "delete"]),
});

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");

  const proposal = await first<{ id: string; event_id: string; status: string }>(
    requestDb(c),
    "SELECT id, event_id, status FROM session_proposals WHERE id = ? AND deleted_at IS NULL",
    [proposalId],
  );
  if (!proposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(requestDb(c), proposal.event_id, admin);
  if (!access.canFinalize) {
    return json({ error: { code: "FORBIDDEN", message: "Missing permission to flag proposals" } }, 403);
  }

  const body = await parseJsonBody(c.req, flagSchema);

  if (body.action === "delete") {
    await softDeleteProposal(requestDb(c), { proposalId });
    await writeAuditLog(requestDb(c), "admin", admin.id, "proposal_deleted", "proposal", proposalId, {
      previousStatus: { from: proposal.status, to: "deleted" },
    });
    return json({ success: true, action: "delete" });
  }

  const previousStatus = proposal.status;
  await markProposalStatus(requestDb(c), { proposalId, status: body.action });
  await writeAuditLog(requestDb(c), "admin", admin.id, "proposal_flagged", "proposal", proposalId, {
    status: { from: previousStatus, to: body.action },
  });

  return json({ success: true, action: body.action });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
