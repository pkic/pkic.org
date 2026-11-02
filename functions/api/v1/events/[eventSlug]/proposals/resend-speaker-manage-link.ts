import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { prepareMagicLinkRequestHttp } from "../../../../../_lib/auth/http-flow";
import { queueProposalSpeakerManageLinkRecovery } from "../../../../../_lib/services/proposal-speaker-link-recovery";
import { proposalResendSpeakerManageLinkRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import type { AdminContext } from "../../../../../_lib/db/context";

async function resendSpeakerManageLink(c: AdminContext, eventSlug: string, email: string): Promise<Response> {
  const http = await prepareMagicLinkRequestHttp(c, email, "proposal-resend-speaker-manage-link");
  const event = await getEventBySlug(http.db, eventSlug);
  const outboxId = await queueProposalSpeakerManageLinkRecovery(http.db, event, email, {
    appBaseUrl: http.appBaseUrl,
    signingSecret: http.secret,
    ttlMinutes: http.magicLinkTtlMinutes,
    ipHash: http.ipHash,
    userAgentHash: http.userAgentHash,
  });
  if (outboxId) c.executionCtx.waitUntil(processOutboxByIdBackground(http.db, c.env, outboxId));
  return json({ success: true });
}

export const EventsEventSlugProposalsResendSpeakerManageLinkPost = openApiRoute(
  proposalResendSpeakerManageLinkRouteSchema,
  (c: AdminContext, data) => resendSpeakerManageLink(c, data.params.eventSlug, data.body.email),
  (c: AdminContext) => c.set?.("sensitive", true),
);
