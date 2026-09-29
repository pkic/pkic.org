import {
  registrationParticipantReadRouteSchema,
  registrationParticipantUpdateRouteSchema,
} from "../../../../assets/shared/schemas/route-contracts-registration-participant";
import {
  registrationManageReadResponseSchema,
  registrationManageUpdateResponseSchema,
} from "../../../../assets/shared/schemas/registration";
import { requireIdentityFromRequest } from "../../../_lib/auth/user-session";
import { getConfig, resolveAppBaseUrl } from "../../../_lib/config";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../_lib/email/outbox";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { enforceEmailTriggerRateLimits } from "../../../_lib/rate-limit";
import { getClientIp, requireInternalSecret } from "../../../_lib/request";
import { getRegistrationByManageToken } from "../../../_lib/services/registrations/queries";
import { buildRegistrationManageView } from "../../../_lib/services/registrations/manage-view";
import { updateManagedRegistration } from "../../../_lib/services/registrations/manage-update";

async function ownedRegistration(c: AdminContext, registrationId: string) {
  const db = requestDb(c);
  const identity = await requireIdentityFromRequest(db, c.req.raw, c.env);
  const authority = { resourceId: registrationId, userId: identity.userId };
  const registration = await getRegistrationByManageToken(db, authority, requireInternalSecret(c.env));
  return { db, authority, registration };
}

export const RegistrationParticipantGet = openApiRoute(
  registrationParticipantReadRouteSchema,
  async (c: AdminContext, data) => {
    const { db, registration } = await ownedRegistration(c, data.params.registrationId);
    return json(
      registrationManageReadResponseSchema.parse(
        await buildRegistrationManageView(db, registration, resolveAppBaseUrl(c.env, c.req.raw)),
      ),
    );
  },
  markResponseSensitive,
);

export const RegistrationParticipantPatch = openApiRoute(
  registrationParticipantUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, authority, registration } = await ownedRegistration(c, data.params.registrationId);
    if (data.body.action === "update" && data.body.email) {
      await enforceEmailTriggerRateLimits({
        emailBinding: c.env.EMAIL_RATE_LIMITER,
        ipBinding: c.env.IP_RATE_LIMITER,
        namespace: "registration-email-change",
        email: data.body.email,
        clientIp: getClientIp(c.req.raw),
      });
    }
    const config = getConfig(c.env, c.req.raw);
    const result = await updateManagedRegistration(db, {
      registration,
      manageToken: authority,
      isAdminManageJwt: false,
      authenticatedActor: { kind: "user", id: authority.userId },
      actorUserId: authority.userId,
      body: data.body,
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
      signingSecret: requireInternalSecret(c.env),
      confirmationLinkTtlHours: config.confirmationLinkTtlHours,
      waitlistClaimWindowHours: config.waitlistClaimWindowHours,
    });
    for (const id of result.outboxIds) {
      c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, id));
    }
    return json(registrationManageUpdateResponseSchema.parse({ success: true, emailChanged: result.emailChanged }));
  },
  markResponseSensitive,
);
