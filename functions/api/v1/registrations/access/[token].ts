import { verifyUserSessionRequest } from "../../../../_lib/auth/user-session-request";
import type { ValidatedData } from "chanfana";
import { handleError, json } from "../../../../_lib/http";
import { updateManagedRegistration } from "../../../../_lib/services/registrations";
import { resolveManageToken } from "../../../../_lib/services/manage-token";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import {
  registrationManageReadResponseSchema,
  registrationManageUpdateResponseSchema,
} from "../../../../../assets/shared/schemas/registration";
import {
  registrationManageReadRouteSchema,
  registrationManageUpdateRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-registrations";
import { requireInternalSecret } from "../../../../_lib/request";
import { buildRegistrationManageView } from "../../../../_lib/services/registrations/manage-view";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { hasAuthenticatedSessionCookie, hasAuthenticationCredential } from "../../../../_lib/auth/session-cookies";
import { requireAnyActorFromRequest } from "../../../../_lib/auth/actor";
import { AppError } from "../../../../_lib/errors";
import { readRegistrationSponsorSharing } from "../../../../_lib/services/event-participation/sponsor-consent";

async function handleRegistrationManagePatch(
  c: any,
  data: ValidatedData<typeof registrationManageUpdateRouteSchema>,
): Promise<Response> {
  try {
    const body = data.body;
    const config = getConfig(c.env, c.req.raw);
    const token = data.params.token;

    const resolved = await resolveManageToken(c.req.raw, c.env, token);
    if (resolved instanceof Response) return resolved;
    const { registration: current, isJwt, actorUserId } = resolved;
    let authenticatedActor: { kind: "user"; id: string } | null = null;
    if (
      !isJwt &&
      (hasAuthenticatedSessionCookie(c.req.raw) ||
        (body.action === "withdraw_sponsor_sharing" && hasAuthenticationCredential(c.req.raw)))
    ) {
      try {
        const actor = await requireAnyActorFromRequest(c.env.DB, c.req.raw, c.env);
        authenticatedActor = { kind: actor.kind, id: actor.id };
      } catch (error) {
        if (!(error instanceof AppError) || error.status !== 401) throw error;
      }
    }
    const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
    const signingSecret = requireInternalSecret(c.env);
    const result = await updateManagedRegistration(c.env.DB, {
      registration: current,
      manageToken: token,
      isAdminManageJwt: isJwt,
      authenticatedActor,
      actorUserId,
      body,
      identitySessionClaims:
        body.identityChange && !isJwt ? await verifyUserSessionRequest(c.req.raw, c.env) : undefined,
      appBaseUrl,
      signingSecret,
      waitlistClaimWindowHours: config.waitlistClaimWindowHours,
    });
    for (const outboxId of result.outboxIds) {
      c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outboxId));
    }

    return json(
      registrationManageUpdateResponseSchema.parse({
        success: true,
        sponsorSharing: await readRegistrationSponsorSharing(c.env.DB, result.registration),
      }),
    );
  } catch (error) {
    return handleError(error);
  }
}

async function handleRegistrationManageGet(
  c: any,
  data: ValidatedData<typeof registrationManageReadRouteSchema>,
): Promise<Response> {
  try {
    const token = data.params.token;
    const resolved = await resolveManageToken(c.req.raw, c.env, token);
    if (resolved instanceof Response) return resolved;
    const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
    const viewer = !resolved.isJwt
      ? await verifyUserSessionRequest(c.req.raw, c.env).catch((error: unknown) => {
          if (error instanceof AppError && error.status === 401) return null;
          throw error;
        })
      : null;
    return json(
      registrationManageReadResponseSchema.parse(
        await buildRegistrationManageView(c.env.DB, resolved.registration, appBaseUrl, viewer?.sub),
      ),
    );
  } catch (error) {
    return handleError(error);
  }
}

function markSensitive(c: any): void {
  c.set("sensitive", true);
}

export const RegistrationsManageTokenGet = openApiRoute(
  registrationManageReadRouteSchema,
  handleRegistrationManageGet,
  markSensitive,
);
export const RegistrationsManageTokenPatch = openApiRoute(
  registrationManageUpdateRouteSchema,
  handleRegistrationManagePatch,
  markSensitive,
);
