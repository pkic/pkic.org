/**
 * GET /api/v1/admin/proposals/:proposalId
 *
 * Returns a single proposal with its proposer info, review count, decision,
 * and the requesting admin's access rights for that event.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../_lib/auth/proposal-access";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { first } from "../../../../../_lib/db/queries";
import { getConfig } from "../../../../../_lib/config";
import { getActiveFormByPurpose } from "../../../../../_lib/services/forms";
import { parseJsonSafe } from "../../../../../_lib/utils/json";
import { resolveSessionTypes } from "../../../../../_lib/services/events";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { proposalIdParamsSchema } from "../../../../../../assets/shared/schemas/api";
import { adminProposalDetailResponseSchema } from "../../../../../../assets/shared/schemas/admin-event-proposals";

interface ProposalDetailRow {
  id: string;
  event_id: string;
  proposer_user_id: string;
  status: string;
  proposal_type: string;
  title: string;
  abstract: string;
  details_json: string | null;
  submitted_at: string;
  updated_at: string;
  proposer_email: string;
  proposer_first_name: string | null;
  proposer_last_name: string | null;
  review_count: number;
  decision_status: string | null;
  decision_note: string | null;
  decision_decided_at: string | null;
}

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");

  const proposal = await first<ProposalDetailRow>(
    requestDb(c),
    `SELECT
       sp.id, sp.event_id, sp.proposer_user_id, sp.status, sp.proposal_type,
       sp.title, sp.abstract, sp.details_json, sp.submitted_at, sp.updated_at,
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
  const [proposalForm, eventRow] = await Promise.all([
    getActiveFormByPurpose(requestDb(c), proposal.event_id, "proposal_submission"),
    first<{ settings_json: string }>(requestDb(c), "SELECT settings_json FROM events WHERE id = ?", [
      proposal.event_id,
    ]),
  ]);
  const eventSettings = parseJsonSafe<{ proposal?: { sessionTypes?: unknown[] } }>(eventRow?.settings_json ?? "{}", {});
  const sessionTypes = resolveSessionTypes(eventSettings);

  return json(
    adminProposalDetailResponseSchema.parse({
      proposal: {
        id: proposal.id,
        event_id: proposal.event_id,
        proposer_user_id: proposal.proposer_user_id,
        status: proposal.status,
        proposal_type: proposal.proposal_type,
        title: proposal.title,
        abstract: proposal.abstract,
        submitted_at: proposal.submitted_at,
        updated_at: proposal.updated_at,
        proposer_email: proposal.proposer_email,
        proposer_first_name: proposal.proposer_first_name,
        proposer_last_name: proposal.proposer_last_name,
        review_count: proposal.review_count,
        decision_status: proposal.decision_status,
        decision_note: proposal.decision_note,
        decision_decided_at: proposal.decision_decided_at,
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
      sessionTypes,
    }),
  );
}

export const AdminProposalsProposalIdGet = openApiRoute(
  {
    tags: ["Admin proposals"],
    summary: "Get proposal details",
    request: {
      params: proposalIdParamsSchema,
    },
    responses: {
      "200": {
        description: "Proposal details visible to the authenticated actor.",
        content: { "application/json": { schema: adminProposalDetailResponseSchema } },
      },
      "401": { description: "Missing or invalid authentication." },
      "404": { description: "Proposal not found." },
    },
  },
  onRequestGet,
);
