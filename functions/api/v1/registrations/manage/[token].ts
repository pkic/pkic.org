import type { ValidatedData } from "chanfana";
import { parseJsonBody } from "../../../../_lib/validation";
import { dispatchRequestMethod, handleError, json } from "../../../../_lib/http";
import { updateManagedRegistration } from "../../../../_lib/services/registrations";
import { resolveManageToken } from "../../../../_lib/services/manage-token";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import {
  registrationManageReadResponseSchema,
  registrationManageSchema,
  registrationManageUpdateResponseSchema,
} from "../../../../../assets/shared/schemas/registration";
import {
  registrationManageReadRouteSchema,
  registrationManageUpdateRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-registrations";
import { requireInternalSecret } from "../../../../_lib/request";
import { buildRegistrationManageView } from "../../../../_lib/services/registrations/manage-view";
import { openApiRoute } from "../../../../_lib/openapi/route";

export async function onRequestPatch(
  c: any,
  data?: ValidatedData<typeof registrationManageUpdateRouteSchema>,
): Promise<Response> {
  try {
    const body = data?.body ?? (await parseJsonBody(c.req, registrationManageSchema));
    const config = getConfig(c.env, c.req.raw);
    const token = data?.params.token ?? c.req.param("token");

    const resolved = await resolveManageToken(c.req.raw, c.env, token);
    if (resolved instanceof Response) return resolved;
    const { registration: current, isJwt, actorUserId } = resolved;
    const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
    const signingSecret = requireInternalSecret(c.env);
    const result = await updateManagedRegistration(c.env.DB, {
      registration: current,
      manageToken: token,
      isAdminManageJwt: isJwt,
      actorUserId,
      body,
      appBaseUrl,
      signingSecret,
      confirmationLinkTtlHours: config.confirmationLinkTtlHours,
      waitlistClaimWindowHours: config.waitlistClaimWindowHours,
    });
    if (result.outboxId) {
      c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, result.outboxId));
    }

    return json(registrationManageUpdateResponseSchema.parse({ success: true, emailChanged: result.emailChanged }));
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequestGet(
  c: any,
  data?: ValidatedData<typeof registrationManageReadRouteSchema>,
): Promise<Response> {
  try {
    const token = data?.params.token ?? c.req.param("token");
    const resolved = await resolveManageToken(c.req.raw, c.env, token);
    if (resolved instanceof Response) return resolved;
    const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
    return json(
      registrationManageReadResponseSchema.parse(
        await buildRegistrationManageView(c.env.DB, resolved.registration, appBaseUrl),
      ),
    );
  } catch (error) {
    return handleError(error);
  }
}

function markSensitive(c: any): void {
  c.set("sensitive", true);
}

export const RegistrationsManageTokenGet = openApiRoute(registrationManageReadRouteSchema, onRequestGet, markSensitive);
export const RegistrationsManageTokenPatch = openApiRoute(
  registrationManageUpdateRouteSchema,
  onRequestPatch,
  markSensitive,
);

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  return dispatchRequestMethod(c, { GET: onRequestGet, PATCH: onRequestPatch });
}
