import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { all } from "../../../../_lib/db/queries";
import { getProposalByManageToken, updateProposalByManageToken } from "../../../../_lib/services/proposals";
import { validateCustomAnswersByPurpose } from "../../../../_lib/services/forms";
import { proposalManageSchema } from "../../../../../assets/shared/schemas/api";

export async function onRequestPatch(c: any): Promise<Response> {
  const body = await parseJsonBody(c.req, proposalManageSchema);
  const existing = await getProposalByManageToken(c.env.DB, c.req.param("token"));
  const proposalDetails = body.details
    ? await validateCustomAnswersByPurpose(c.env.DB, {
        eventId: existing.event_id,
        purpose: "proposal_submission",
        customAnswers: body.details,
      })
    : {};

  const proposal = await updateProposalByManageToken(c.env.DB, {
    manageToken: c.req.param("token"),
    action: body.action,
    proposalType: body.proposalType,
    title: body.title,
    abstract: body.abstract,
    detailsJson: Object.keys(proposalDetails).length > 0 ? JSON.stringify(proposalDetails) : null,
  });

  return json({ success: true, proposal });
}

export async function onRequestGet(c: any): Promise<Response> {
  const proposal = await getProposalByManageToken(c.env.DB, c.req.param("token"));
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
    c.env.DB,
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

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  if (c.req.raw.method === "PATCH") {
    return onRequestPatch(c);
  }

  if (c.req.raw.method === "GET") {
    return onRequestGet(c);
  }

  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
