/**
 * POST /api/v1/invites/resend-link
 *
 * Sends fresh links for pending or expired invitations matching the supplied
 * email. The response is generic to prevent invitation enumeration.
 */
import { processOutboxByIdBackground } from "../../../_lib/email/outbox";
import { resolveAppBaseUrl } from "../../../_lib/config";
import { json } from "../../../_lib/http";
import { getClientIp } from "../../../_lib/request";
import { enforceEmailTriggerRateLimits } from "../../../_lib/rate-limit";
import { recoverInviteLinksByEmail } from "../../../_lib/services/invite-link-recovery";
import { inviteResendLinkRouteSchema } from "../../../../assets/shared/schemas/route-contracts";
import { openApiRoute } from "../../../_lib/openapi/route";
import { requestDb, type AdminContext } from "../../../_lib/db/context";

async function resendInviteLinks(c: AdminContext, email: string): Promise<Response> {
  await enforceEmailTriggerRateLimits({
    emailBinding: c.env.EMAIL_RATE_LIMITER,
    ipBinding: c.env.IP_RATE_LIMITER,
    namespace: "invite-resend-link",
    email,
    clientIp: getClientIp(c.req.raw),
  });

  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const db = requestDb(c);
  const outboxIds = await recoverInviteLinksByEmail(db, email, appBaseUrl);
  for (const outboxId of outboxIds) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));
  }

  return json({ success: true });
}

export const InvitesResendLinkPost = openApiRoute(
  inviteResendLinkRouteSchema,
  (c: AdminContext, data) => resendInviteLinks(c, data.body.email),
  (c: AdminContext) => c.set?.("sensitive", true),
);
