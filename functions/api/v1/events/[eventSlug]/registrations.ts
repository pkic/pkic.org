import { requireIdentityFromRequest } from "../../../../_lib/auth/user-session";
import { AppError } from "../../../../_lib/errors";
import {
  selectRegistrationIdentity,
  prepareSelectedRegistrationIdentityGuard,
} from "../../../../_lib/services/registrations/selected-identity";
import type { ValidatedData } from "chanfana";
import { registrationSubmissionResponseSchema } from "../../../../../assets/shared/schemas/registration";
import { eventRegistrationCreateRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-registrations";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { json } from "../../../../_lib/http";
import { getClientIp, getUserAgent, requireInternalSecret } from "../../../../_lib/request";
import { submitPublicRegistration } from "../../../../_lib/services/registrations/public-submission";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { enforceEmailTriggerRateLimits } from "../../../../_lib/rate-limit";

async function handlePublicRegistration(
  c: any,
  data: ValidatedData<typeof eventRegistrationCreateRouteSchema>,
): Promise<Response> {
  const request = c.req.raw as Request;
  await enforceEmailTriggerRateLimits({
    emailBinding: c.env.EMAIL_RATE_LIMITER,
    ipBinding: c.env.IP_RATE_LIMITER,
    namespace: "registration-create",
    email: data.body.email,
    clientIp: getClientIp(request),
  });
  const actor = data.body.identityId ? await requireIdentityFromRequest(c.env.DB, request, c.env) : null;
  if (actor && actor.email.toLowerCase() !== data.body.email.toLowerCase()) {
    throw new AppError(
      422,
      "REGISTRATION_SESSION_EMAIL_REQUIRED",
      "Use your signed-in email when selecting an existing identity.",
    );
  }
  const selectedIdentity =
    actor && data.body.identityId
      ? await selectRegistrationIdentity(c.env.DB, actor.userId, data.body.identityId)
      : undefined;
  const config = getConfig(c.env, request);
  const result = await submitPublicRegistration(c.env.DB, c.env, data.body, {
    eventSlug: data.params.eventSlug,
    verifiedIdentity: selectedIdentity ? { userId: selectedIdentity.userId, selectedIdentity } : undefined,
    authorizationGuards:
      selectedIdentity && actor
        ? [
            prepareSelectedRegistrationIdentityGuard(
              c.env.DB,
              selectedIdentity,
              actor.sessionId,
              data.body.email.toLowerCase(),
            ),
          ]
        : [],
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
  return json(registrationSubmissionResponseSchema.parse(result.response));
}

export const EventsEventSlugRegistrationsPost = openApiRoute(
  eventRegistrationCreateRouteSchema,
  handlePublicRegistration,
  (c: any) => c.set("sensitive", true),
);
