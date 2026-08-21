/**
 * POST /api/v1/events/:eventSlug/proposals/resend-manage-link
 *
 * Sends fresh proposer-management links for active proposals matching the
 * provided email. The generic response prevents account enumeration.
 */
import { processSelectedOutboxBackground } from "../../../../../_lib/email/outbox";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { json } from "../../../../../_lib/http";
import { getClientIp } from "../../../../../_lib/request";
import { enforceEmailTriggerRateLimits } from "../../../../../_lib/rate-limit";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { queueProposalManageLinkRecovery } from "../../../../../_lib/services/proposal-manage-link-recovery";
import { proposalResendManageLinkRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

async function resendProposalManageLinks(c: AdminContext, eventSlug: string, email: string): Promise<Response> {
  await enforceEmailTriggerRateLimits({
    emailBinding: c.env.EMAIL_RATE_LIMITER,
    ipBinding: c.env.IP_RATE_LIMITER,
    namespace: "proposal-resend-manage-link",
    email,
    clientIp: getClientIp(c.req.raw),
  });

  const db = requestDb(c);
  const event = await getEventBySlug(db, eventSlug);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const outboxIds = await queueProposalManageLinkRecovery(db, event, email, appBaseUrl);
  if (outboxIds.length > 0) {
    c.executionCtx.waitUntil(processSelectedOutboxBackground(db, c.env, outboxIds));
  }

  return json({ success: true });
}

export const EventsEventSlugProposalsResendManageLinkPost = openApiRoute(
  proposalResendManageLinkRouteSchema,
  (c: AdminContext, data) => resendProposalManageLinks(c, data.params.eventSlug, data.body.email),
  (c: AdminContext) => c.set?.("sensitive", true),
);
