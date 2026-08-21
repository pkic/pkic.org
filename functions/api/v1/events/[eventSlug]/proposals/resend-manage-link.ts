/**
 * POST /api/v1/events/:eventSlug/proposals/resend-manage-link
 *
 * Sends fresh proposer-management links for active proposals matching the
 * provided email. The generic response prevents account enumeration.
 */
import { OpenAPIRoute } from "chanfana";
import { processSelectedOutboxBackground } from "../../../../../_lib/email/outbox";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { json } from "../../../../../_lib/http";
import { getClientIp } from "../../../../../_lib/request";
import { enforceRateLimit } from "../../../../../_lib/rate-limit";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { queueProposalManageLinkRecovery } from "../../../../../_lib/services/proposal-manage-link-recovery";
import { parseJsonBody } from "../../../../../_lib/validation";
import { proposalResendManageLinkSchema } from "../../../../../../assets/shared/schemas/api";
import { proposalResendManageLinkRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";

export async function onRequestPost(c: any): Promise<Response> {
  c.set("sensitive", true);

  const body = await parseJsonBody(c.req, proposalResendManageLinkSchema);
  await enforceRateLimit({
    binding: c.env.EMAIL_RATE_LIMITER,
    namespace: "proposal-resend-manage-link:email",
    key: body.email,
  });
  await enforceRateLimit({
    binding: c.env.IP_RATE_LIMITER,
    namespace: "proposal-resend-manage-link:ip",
    key: getClientIp(c.req.raw),
  });

  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const outboxIds = await queueProposalManageLinkRecovery(c.env.DB, event, body.email, appBaseUrl);
  if (outboxIds.length > 0) {
    c.executionCtx.waitUntil(processSelectedOutboxBackground(c.env.DB, c.env, outboxIds));
  }

  return json({ success: true });
}

export class EventsEventSlugProposalsResendManageLinkPost extends OpenAPIRoute {
  schema = proposalResendManageLinkRouteSchema;

  async handle(c: any) {
    return onRequestPost(c);
  }
}
