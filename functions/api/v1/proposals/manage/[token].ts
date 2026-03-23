import { parseJsonBody } from "../../../../_lib/validation";
import { json, markSensitive } from "../../../../_lib/http";
import { all } from "../../../../_lib/db/queries";
import { getProposalByManageToken, updateProposalByManageToken } from "../../../../_lib/services/proposals";
import { validateCustomAnswersByPurpose } from "../../../../_lib/services/forms";
import type { PagesContext } from "../../../../_lib/types";
import { proposalManageSchema } from "../../../../../assets/shared/schemas/api";

export async function onRequestPatch(context: PagesContext<{ token: string }>): Promise<Response> {
  const body = await parseJsonBody(context.request, proposalManageSchema);
  const existing = await getProposalByManageToken(context.env.DB, context.params.token);
  const proposalDetails = body.details
    ? await validateCustomAnswersByPurpose(context.env.DB, {
      eventId: existing.event_id,
      purpose: "proposal_submission",
      customAnswers: body.details,
    })
    : {};

  const proposal = await updateProposalByManageToken(context.env.DB, {
    manageToken: context.params.token,
    action: body.action,
    proposalType: body.proposalType,
    title: body.title,
    abstract: body.abstract,
    detailsJson: Object.keys(proposalDetails).length > 0 ? JSON.stringify(proposalDetails) : null,
  });

  return json({ success: true, proposal });
}

export async function onRequestGet(context: PagesContext<{ token: string }>): Promise<Response> {
  const proposal = await getProposalByManageToken(context.env.DB, context.params.token);
  const speakers = await all<{
    user_id: string;
    role: string;
    status: string;
    confirmed_at: string | null;
    declined_at: string | null;
    email: string;
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
    job_title: string | null;
    biography: string | null;
    links_json: string | null;
  }>(
    context.env.DB,
        `SELECT ps.user_id, ps.role, ps.status, ps.confirmed_at, ps.declined_at,
          u.email, u.first_name, u.last_name, u.organization_name, u.job_title, u.biography, u.links_json
     FROM proposal_speakers ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.proposal_id = ?
     ORDER BY ps.created_at ASC`,
    [proposal.id],
  );

  return json({
    success: true,
    proposal: {
      ...proposal,
      details: proposal.details_json ? JSON.parse(proposal.details_json) : null,
    },
    speakers: speakers.map((entry) => ({
      userId: entry.user_id,
      role: entry.role,
      status: entry.status,
      confirmedAt: entry.confirmed_at,
      declinedAt: entry.declined_at,
      email: entry.email,
      firstName: entry.first_name,
      lastName: entry.last_name,
      organizationName: entry.organization_name,
      jobTitle: entry.job_title,
      bio: entry.biography,
      links: entry.links_json ? JSON.parse(entry.links_json) : [],
    })),
  });
}

export async function onRequest(context: PagesContext<{ token: string }>): Promise<Response> {
  markSensitive(context);
  if (context.request.method === "PATCH") {
    return onRequestPatch(context);
  }

  if (context.request.method === "GET") {
    return onRequestGet(context);
  }

  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
