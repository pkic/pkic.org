/**
 * POST /api/v1/auth/passkeys/register/complete.
 */
import { OpenAPIRoute } from "chanfana";
import { jsonNoStore } from "../../../../_lib/http";
import { requireAnyActorFromRequest } from "../../../../_lib/auth/actor";
import { parseJsonBody } from "../../../../_lib/validation";
import { completePasskeyRegistration } from "../../../../_lib/services/passkeys";
import {
  passkeyRegisterCompleteRouteSchema,
  passkeyRegisterCompleteSchema,
} from "../../../../../assets/shared/schemas/passkeys";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

// Left as a manual OpenAPIRoute (not openApiRoute-wrapped): this endpoint
// must reject an unauthenticated caller with 401 AUTH_REQUIRED even when the
// request body is missing/malformed (see tests/api-security.test.ts's
// "protected endpoint — rejects unauthenticated requests" suite). chanfana's
// getValidatedData() always runs — and would 400 on the missing required
// body — before an openApiRoute handler ever executes, which would let a
// validation failure preempt the auth check. Auth is checked first here,
// body parsed after, same as before this migration.
export async function onRequestPost(c: AdminContext): Promise<Response> {
  const actor = await requireAnyActorFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, passkeyRegisterCompleteSchema);

  const passkey = await completePasskeyRegistration(requestDb(c), c.env, actor, {
    challengeToken: body.challengeToken,
    response: body.response,
    deviceName: body.deviceName,
  });

  return jsonNoStore(passkey, 201);
}

export class PasskeyRegisterComplete extends OpenAPIRoute {
  schema = passkeyRegisterCompleteRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
