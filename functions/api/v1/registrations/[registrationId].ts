import { verifyUserSessionRequest } from "../../../_lib/auth/user-session-request";
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
import { requireInternalSecret } from "../../../_lib/request";
import { getRegistrationByManageToken } from "../../../_lib/services/registrations/queries";
import { buildRegistrationManageView } from "../../../_lib/services/registrations/manage-view";
import { updateManagedRegistration } from "../../../_lib/services/registrations/manage-update";
import { readRegistrationSponsorSharing } from "../../../_lib/services/event-participation/sponsor-consent";

async function ownedRegistration(c: AdminContext, registrationId: string) {
  const db = requestDb(c);
  const identity = await requireIdentityFromRequest(db, c.req.raw, c.env);
  const authority = { resourceId: registrationId, userId: identity.userId, sessionId: identity.sessionId };
  const registration = await getRegistrationByManageToken(db, authority, requireInternalSecret(c.env));
  return { db, authority, registration };
}

export const RegistrationParticipantGet = openApiRoute(
  registrationParticipantReadRouteSchema,
  async (c: AdminContext, data) => {
    const { db, authority, registration } = await ownedRegistration(c, data.params.registrationId);
    return json(
      registrationManageReadResponseSchema.parse(
        await buildRegistrationManageView(db, registration, resolveAppBaseUrl(c.env, c.req.raw), authority.userId),
      ),
    );
  },
  markResponseSensitive,
);

export const RegistrationParticipantPatch = openApiRoute(
  registrationParticipantUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, authority, registration } = await ownedRegistration(c, data.params.registrationId);
    const config = getConfig(c.env, c.req.raw);
    const result = await updateManagedRegistration(db, {
      registration,
      manageToken: authority,
      isAdminManageJwt: false,
      authenticatedActor: { kind: "user", id: authority.userId },
      actorUserId: authority.userId,
      body: data.body,
      identitySessionClaims: data.body.identityChange ? await verifyUserSessionRequest(c.req.raw, c.env) : undefined,
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
      signingSecret: requireInternalSecret(c.env),
      confirmationLinkTtlHours: config.confirmationLinkTtlHours,
      waitlistClaimWindowHours: config.waitlistClaimWindowHours,
    });
    for (const id of result.outboxIds) {
      c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, id));
    }
    return json(
      registrationManageUpdateResponseSchema.parse({
        success: true,
        sponsorSharing: await readRegistrationSponsorSharing(db, result.registration),
      }),
    );
  },
  markResponseSensitive,
);
