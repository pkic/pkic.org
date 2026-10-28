import { updateRegistrationProofPerson } from "../../../../../_lib/services/registrations/proof-person";
import { registrationProofPersonPatchResponseSchema } from "../../../../../../assets/shared/schemas/registration-email-proof";
import { registrationProofPersonPatchRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-registrations";
import { requestDb } from "../../../../../_lib/db/context";
import {
  registrationEmailProofStartResponseSchema,
  registrationEmailProofVerifyResponseSchema,
} from "../../../../../../assets/shared/schemas/registration-email-proof";
import {
  registrationEmailProofStartRouteSchema,
  registrationEmailProofVerifyRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-registrations";
import { getConfig, resolveAppBaseUrl } from "../../../../../_lib/config";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { json, jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { enforceEmailTriggerRateLimits } from "../../../../../_lib/rate-limit";
import { getClientIp, requireInternalSecret } from "../../../../../_lib/request";
import { getEventBySlug } from "../../../../../_lib/services/events";
import {
  startRegistrationEmailProof,
  verifyRegistrationEmailProof,
} from "../../../../../_lib/services/registrations/email-proof";

export const RegistrationEmailProofPost = openApiRoute(registrationEmailProofStartRouteSchema, async (c, data) => {
  await enforceEmailTriggerRateLimits({
    emailBinding: c.env.EMAIL_RATE_LIMITER,
    ipBinding: c.env.IP_RATE_LIMITER,
    namespace: "registration-email-proof",
    email: data.body.email,
    clientIp: getClientIp(c.req.raw),
  });
  const event = await getEventBySlug(c.env.DB, data.params.eventSlug);
  const result = await startRegistrationEmailProof(c.env.DB, {
    event,
    body: data.body,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    ttlSeconds: getConfig(c.env, c.req.raw).confirmationLinkTtlHours * 60 * 60,
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, result.outboxId));
  return json(registrationEmailProofStartResponseSchema.parse({ status: result.status }));
});

export const RegistrationEmailProofVerifyPost = openApiRoute(
  registrationEmailProofVerifyRouteSchema,
  async (c, data) => {
    return jsonPrivate(
      registrationEmailProofVerifyResponseSchema.parse(
        await verifyRegistrationEmailProof(requestDb(c), {
          signingSecret: requireInternalSecret(c.env),
          token: data.body.token,
          eventSlug: data.params.eventSlug,
          domain: data.body.domain,
          affiliation: data.body.affiliation,
        }),
      ),
    );
  },
);

export const RegistrationProofPersonPatch = openApiRoute(registrationProofPersonPatchRouteSchema, async (c, data) =>
  jsonPrivate(
    registrationProofPersonPatchResponseSchema.parse(
      await updateRegistrationProofPerson(requestDb(c), {
        eventSlug: data.params.eventSlug,
        signingSecret: requireInternalSecret(c.env),
        body: data.body,
      }),
    ),
  ),
);
