import type { ValidatedData } from "chanfana";
import {
  registrationCreateSchema,
  registrationSubmissionResponseSchema,
} from "../../../../../assets/shared/schemas/registration";
import { eventRegistrationCreateRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-registrations";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { dispatchPostOnly, json } from "../../../../_lib/http";
import { getClientIp, getUserAgent, requireInternalSecret } from "../../../../_lib/request";
import { submitPublicRegistration } from "../../../../_lib/services/registrations/public-submission";
import { parseJsonBody } from "../../../../_lib/validation";
import { openApiRoute } from "../../../../_lib/openapi/route";

export async function onRequestPost(
  c: any,
  data?: ValidatedData<typeof eventRegistrationCreateRouteSchema>,
): Promise<Response> {
  const request = c.req.raw as Request;
  const config = getConfig(c.env, request);
  const result = await submitPublicRegistration(
    c.env.DB,
    c.env,
    data?.body ?? (await parseJsonBody(c.req, registrationCreateSchema)),
    {
      eventSlug: data?.params.eventSlug ?? c.req.param("eventSlug"),
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
    },
  );
  for (const task of result.backgroundTasks) c.executionCtx.waitUntil(task);
  return json(registrationSubmissionResponseSchema.parse(result.response));
}

export const EventsEventSlugRegistrationsPost = openApiRoute(
  eventRegistrationCreateRouteSchema,
  onRequestPost,
  (c: any) => c.set("sensitive", true),
);

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  return dispatchPostOnly(c, onRequestPost);
}
