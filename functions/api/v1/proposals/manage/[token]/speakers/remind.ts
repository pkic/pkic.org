import { dispatchPostOnly, json } from "../../../../../../_lib/http";
import { parseJsonBody } from "../../../../../../_lib/validation";
import { getProposalByManageToken } from "../../../../../../_lib/services/proposals";
import { remindProposalSpeakerByProposer } from "../../../../../../_lib/services/proposal-reminders";
import { processOutboxByIdBackground } from "../../../../../../_lib/email/outbox";
import { resolveAppBaseUrl } from "../../../../../../_lib/config";
import { requireInternalSecret } from "../../../../../../_lib/request";
import { proposalSpeakerReminderRequestSchema } from "../../../../../../../assets/shared/schemas/proposal-management";

export async function onRequestPost(c: any): Promise<Response> {
  const body = await parseJsonBody(c.req, proposalSpeakerReminderRequestSchema);
  const proposal = await getProposalByManageToken(c.env.DB, c.req.param("token"), requireInternalSecret(c.env));
  const result = await remindProposalSpeakerByProposer(c.env.DB, {
    proposal,
    userId: body.userId,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, result.outboxId));
  return json({ success: true });
}

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  return dispatchPostOnly(c, onRequestPost);
}
