import { registrationCreateSchema } from "../../../../../assets/shared/schemas/registration";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { dispatchPostOnly, json } from "../../../../_lib/http";
import { getClientIp, getUserAgent, requireInternalSecret } from "../../../../_lib/request";
import { submitPublicRegistration } from "../../../../_lib/services/registrations/public-submission";
import { parseJsonBody } from "../../../../_lib/validation";

export async function onRequestPost(c: any): Promise<Response> {
  const request = c.req.raw as Request;
  const config = getConfig(c.env, request);
  const result = await submitPublicRegistration(c.env.DB, c.env, await parseJsonBody(c.req, registrationCreateSchema), {
    eventSlug: c.req.param("eventSlug"),
    eventBasePath: request.headers.get("x-event-base-path"),
    clientIp: getClientIp(request),
    userAgent: getUserAgent(request),
    appBaseUrl: resolveAppBaseUrl(c.env, request),
    signingSecret: requireInternalSecret(c.env),
    config: {
      maxPendingConfirmationReminders: config.maxPendingConfirmationReminders,
      pendingConfirmationReminderIntervalDays: config.pendingConfirmationReminderIntervalDays,
      confirmationLinkTtlHours: config.confirmationLinkTtlHours,
      referralCodeLength: config.referralCodeLength,
    },
  });
  for (const task of result.backgroundTasks) c.executionCtx.waitUntil(task);
  return json(result.response);
}

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  return dispatchPostOnly(c, onRequestPost);
}
