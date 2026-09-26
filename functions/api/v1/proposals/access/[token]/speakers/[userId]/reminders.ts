import type { ParticipantRouteData } from "../../../../../../../_lib/routes/participant-authority";
import { json } from "../../../../../../../_lib/http";
import { getProposalByManageToken } from "../../../../../../../_lib/services/proposals";
import { remindProposalSpeakerByProposer } from "../../../../../../../_lib/services/proposal-reminders";
import { processOutboxByIdBackground } from "../../../../../../../_lib/email/outbox";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { requireInternalSecret } from "../../../../../../../_lib/request";
import { successResponseSchema } from "../../../../../../../../assets/shared/schemas/api-common";
import { proposalAccessSpeakerReminderCreateRouteSchema } from "../../../../../../../../assets/shared/schemas/route-contracts-public-proposals";
import type { AdminContext } from "../../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";

type ProposalAccessSpeakerContext = AdminContext;

function markProposalAccessSensitive(c: ProposalAccessSpeakerContext): void {
  c.set?.("sensitive", true);
}

export async function handleProposalSpeakerReminder(
  c: ProposalAccessSpeakerContext,
  data: ParticipantRouteData<typeof proposalAccessSpeakerReminderCreateRouteSchema>,
): Promise<Response> {
  const proposal = await getProposalByManageToken(c.env.DB, data.params.token, requireInternalSecret(c.env));
  const result = await remindProposalSpeakerByProposer(c.env.DB, {
    proposal,
    userId: data.params.userId,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, result.outboxId));
  return json(successResponseSchema.parse({ success: true }));
}

export const ProposalAccessSpeakerReminderCreate = openApiRoute(
  proposalAccessSpeakerReminderCreateRouteSchema,
  handleProposalSpeakerReminder,
  markProposalAccessSensitive,
);
