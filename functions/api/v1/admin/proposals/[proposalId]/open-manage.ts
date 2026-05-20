/**
 * POST /api/v1/admin/proposals/:proposalId/open-manage
 *
 * Refreshes the proposer manage token and returns a fresh manage URL so admins
 * can inspect the live proposer workflow from the user's perspective.
 */
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../_lib/auth/proposal-access";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { first } from "../../../../../_lib/db/queries";
import { json } from "../../../../../_lib/http";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { proposalManagePageUrl } from "../../../../../_lib/services/frontend-links";
import { refreshProposalManageToken } from "../../../../../_lib/services/proposals";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");

  const proposal = await first<{
    id: string;
    event_id: string;
    slug: string;
    base_path: string | null;
    starts_at: string | null;
    settings_json: string;
  }>(
    requestDb(c),
    `SELECT
       sp.id,
       sp.event_id,
       e.slug,
       e.base_path,
       e.starts_at,
       COALESCE(e.settings_json, '{}') AS settings_json
     FROM session_proposals sp
     JOIN events e ON e.id = sp.event_id
     WHERE sp.id = ?`,
    [proposalId],
  );

  if (!proposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(requestDb(c), proposal.event_id, admin);
  if (!access.canReview) {
    return json({ error: { code: "FORBIDDEN", message: "Missing permission to manage proposals" } }, 403);
  }

  const token = await refreshProposalManageToken(requestDb(c), proposalId);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const manageUrl = proposalManagePageUrl(appBaseUrl, proposal, token);

  await writeAuditLog(requestDb(c), "admin", admin.id, "admin_opened_proposal_manage_page", "proposal", proposalId, {
    adminEmail: admin.email,
    eventSlug: proposal.slug,
  });

  return json({ manageUrl });
}
