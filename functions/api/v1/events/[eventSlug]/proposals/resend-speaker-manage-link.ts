/**
 * POST /api/v1/events/:eventSlug/proposals/resend-speaker-manage-link
 *
 * Sends a fresh speaker-management link to the provided email if it matches
 * an invited/confirmed speaker on an active proposal for this event.
 *
 * Always responds with { success: true } to prevent account enumeration.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { getClientIp } from "../../../../../_lib/request";
import { enforceEmailTriggerRateLimits } from "../../../../../_lib/rate-limit";
import { queueProposalSpeakerManageLinkRecovery } from "../../../../../_lib/services/proposal-speaker-link-recovery";
import { proposalResendSpeakerManageLinkRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

async function resendSpeakerManageLink(c: AdminContext, eventSlug: string, email: string): Promise<Response> {
  await enforceEmailTriggerRateLimits({
    emailBinding: c.env.EMAIL_RATE_LIMITER,
    ipBinding: c.env.IP_RATE_LIMITER,
    namespace: "proposal-resend-speaker-manage-link",
    email,
    clientIp: getClientIp(c.req.raw),
  });

  const db = requestDb(c);
  const event = await getEventBySlug(db, eventSlug);
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const outboxId = await queueProposalSpeakerManageLinkRecovery(db, event, email, appBaseUrl);
  if (outboxId) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));
  }

  return json({ success: true });
}

export const EventsEventSlugProposalsResendSpeakerManageLinkPost = openApiRoute(
  proposalResendSpeakerManageLinkRouteSchema,
  (c: AdminContext, data) => resendSpeakerManageLink(c, data.params.eventSlug, data.body.email),
  (c: AdminContext) => c.set?.("sensitive", true),
);
