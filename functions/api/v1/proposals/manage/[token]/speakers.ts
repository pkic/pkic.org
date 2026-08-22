/**
 * Proposer-only: invite a co-speaker to an existing proposal.
 *
 * POST /api/v1/proposals/manage/[token]/speakers
 *   Body: { email, firstName?, lastName?, role }
 *   Auth: possession of the proposal manage token proves proposer identity.
 *
 * Only the proposer holds the proposal manage token — co-speakers hold separate
 * per-speaker tokens and cannot reach this endpoint.
 */
import { dispatchPostOnly, json } from "../../../../../_lib/http";
import { parseJsonBody } from "../../../../../_lib/validation";
import { getProposalByManageToken } from "../../../../../_lib/services/proposals";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { getEventById } from "../../../../../_lib/services/events";
import { coSpeakerInviteSchema } from "../../../../../../assets/shared/schemas/proposal-management";
import { requireInternalSecret } from "../../../../../_lib/request";
import { inviteProposalSpeaker } from "../../../../../_lib/services/proposal-speaker-invitations";
import { isProposalSpeakerRosterEditableStatus } from "../../../../../../assets/shared/schemas/proposal-status";

export async function onRequestPost(c: any): Promise<Response> {
  const body = await parseJsonBody(c.req, coSpeakerInviteSchema);
  const proposal = await getProposalByManageToken(c.env.DB, c.req.param("token"), requireInternalSecret(c.env));

  if (!isProposalSpeakerRosterEditableStatus(proposal.status)) {
    return json({ error: { code: "PROPOSAL_CLOSED", message: "Cannot invite speakers to a closed proposal" } }, 400);
  }

  const event = await getEventById(c.env.DB, proposal.event_id);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  const invited = await inviteProposalSpeaker(c.env.DB, {
    proposal,
    event,
    appBaseUrl,
    email: body.email,
    firstName: body.firstName,
    lastName: body.lastName,
    role: body.role,
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, invited.outboxId));

  return json({ success: true, email: invited.email, role: body.role });
}

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  return dispatchPostOnly(c, onRequestPost);
}
