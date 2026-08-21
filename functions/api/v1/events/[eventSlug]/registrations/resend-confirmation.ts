import type { z } from "zod";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { getConfig, resolveAppBaseUrl } from "../../../../../_lib/config";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { recoverRegistrationConfirmation } from "../../../../../_lib/services/registrations/confirmation-recovery";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { registrationResendConfirmationSchema } from "../../../../../../assets/shared/schemas/registration";
import { registrationResendConfirmationRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import { getClientIp, requireInternalSecret } from "../../../../../_lib/request";
import { enforceEmailTriggerRateLimits } from "../../../../../_lib/rate-limit";

export async function onRequestPost(
  c: any,
  data?: { body: z.infer<typeof registrationResendConfirmationSchema> },
): Promise<Response> {
  c.set("sensitive", true);
  const body = data?.body ?? (await parseJsonBody(c.req, registrationResendConfirmationSchema));
  await enforceEmailTriggerRateLimits({
    emailBinding: c.env.EMAIL_RATE_LIMITER,
    ipBinding: c.env.IP_RATE_LIMITER,
    namespace: "registration-resend-confirmation",
    email: body.email,
    clientIp: getClientIp(c.req.raw),
  });
  const config = getConfig(c.env, c.req.raw);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const recovered = await recoverRegistrationConfirmation(c.env.DB, {
    event,
    token: body.token,
    registrationId: body.id,
    email: body.email,
    signingSecret: requireInternalSecret(c.env),
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    confirmationTtlHours: config.confirmationLinkTtlHours,
  });
  if (recovered) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, recovered.outboxId));
  }
  return json({ ok: true });
}

export const EventsEventSlugRegistrationsResendConfirmationPost = openApiRoute(
  registrationResendConfirmationRouteSchema,
  onRequestPost,
);
