/**
 * GET /api/v1/admin/proposals/:proposalId
 *
 * Returns a single proposal with its proposer info, review count, decision,
 * and the requesting admin's access rights for that event.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../_lib/auth/proposal-access";
import { first } from "../../../../../_lib/db/queries";
import { getConfig } from "../../../../../_lib/config";
import { getActiveFormByPurpose } from "../../../../../_lib/services/forms";
import { parseJsonSafe } from "../../../../../_lib/utils/json";
import type { ProposalListRecord } from "../../../../../_lib/services/proposals";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");

  const proposal = await first<ProposalListRecord>(
    requestDb(c),
    `SELECT
       sp.*,
       u.email      AS proposer_email,
       u.first_name AS proposer_first_name,
       u.last_name  AS proposer_last_name,
       COALESCE(rv.review_count, 0) AS review_count,
       pd.final_status AS decision_status,
       pd.decision_note AS decision_note,
       pd.decided_at AS decision_decided_at
     FROM session_proposals sp
     JOIN users u ON u.id = sp.proposer_user_id
     LEFT JOIN (
       SELECT proposal_id, COUNT(*) AS review_count
       FROM proposal_reviews
       WHERE status = 'submitted'
       GROUP BY proposal_id
     ) rv ON rv.proposal_id = sp.id
     LEFT JOIN proposal_decisions pd ON pd.proposal_id = sp.id
     WHERE sp.id = ?`,
    [proposalId],
  );

  if (!proposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(requestDb(c), proposal.event_id, admin);
  const config = getConfig(c.env, c.req.raw);
  const proposalForm = await getActiveFormByPurpose(requestDb(c), proposal.event_id, "proposal_submission");

  return json({
    proposal: {
      ...proposal,
      details: parseJsonSafe<Record<string, unknown> | null>(proposal.details_json, null),
    },
    access,
    form:
      proposalForm == null
        ? null
        : {
            id: proposalForm.id,
            title: proposalForm.title,
            description: proposalForm.description,
            fields: proposalForm.fields,
          },
    minReviewsRequired: config.minProposalReviews,
  });
}
