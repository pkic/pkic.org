import { parseJsonBody } from "../../../../_lib/validation";
import { dispatchRequestMethod, handleError, json } from "../../../../_lib/http";
import { updateManagedRegistration } from "../../../../_lib/services/registrations";
import { resolveManageToken } from "../../../../_lib/services/manage-token";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { registrationManageSchema } from "../../../../../assets/shared/schemas/registration";
import { requireInternalSecret } from "../../../../_lib/request";
import { omitCapabilitySecrets } from "../../../../_lib/services/capability-links";
import { buildRegistrationManageView } from "../../../../_lib/services/registrations/manage-view";

export async function onRequestPatch(c: any): Promise<Response> {
  try {
    const body = await parseJsonBody(c.req, registrationManageSchema);
    const config = getConfig(c.env, c.req.raw);
    const token = c.req.param("token");

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
      waitlistClaimWindowHours: config.waitlistClaimWindowHours,
    });
    if (result.outboxId) {
      c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, result.outboxId));
    }

    return json({
      success: true,
      registration: omitCapabilitySecrets(result.registration),
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequestGet(c: any): Promise<Response> {
  try {
    const token = c.req.param("token");
    const resolved = await resolveManageToken(c.req.raw, c.env, token);
    if (resolved instanceof Response) return resolved;
    const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
    return json(await buildRegistrationManageView(c.env.DB, resolved.registration, token, appBaseUrl));
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  return dispatchRequestMethod(c, { GET: onRequestGet, PATCH: onRequestPatch });
}
