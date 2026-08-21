/**
 * POST /api/v1/events/:eventSlug/registrations/resend-manage-link
 *
 * Queues a fresh, expiring management link without invalidating other
 * unexpired links sent to the attendee.
 *
 * The response is always { success: true } regardless of whether the email
 * matched a registration — this prevents enumeration of registered attendees.
 */
import { json } from "../../../../../_lib/http";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { getClientIp } from "../../../../../_lib/request";
import { enforceEmailTriggerRateLimits } from "../../../../../_lib/rate-limit";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { queueRegistrationManageLinkRecovery } from "../../../../../_lib/services/registrations/manage-link-recovery";
import { registrationResendManageLinkRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

async function resendRegistrationManageLink(c: AdminContext, eventSlug: string, email: string): Promise<Response> {
  await enforceEmailTriggerRateLimits({
    emailBinding: c.env.EMAIL_RATE_LIMITER,
    ipBinding: c.env.IP_RATE_LIMITER,
    namespace: "registration-resend-manage-link",
    email,
    clientIp: getClientIp(c.req.raw),
  });

  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const db = requestDb(c);
  const event = await getEventBySlug(db, eventSlug);
  const outboxId = await queueRegistrationManageLinkRecovery(db, event, email, appBaseUrl);
  if (outboxId) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));
  }

  return json({ success: true });
}

export const EventsEventSlugRegistrationsResendManageLinkPost = openApiRoute(
  registrationResendManageLinkRouteSchema,
  (c: AdminContext, data) => resendRegistrationManageLink(c, data.params.eventSlug, data.body.email),
  (c: AdminContext) => c.set?.("sensitive", true),
);
