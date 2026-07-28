/**
 * POST /api/v1/auth/passkeys/register/complete — PRD §3.4.
 */
import { OpenAPIRoute } from "chanfana";
import { jsonNoStore } from "../../../../_lib/http";
import { requireAnyActorFromRequest } from "../../../../_lib/auth/actor";
import { parseJsonBody } from "../../../../_lib/validation";
import { completePasskeyRegistration } from "../../../../_lib/services/passkeys";
import { writeAuditLog } from "../../../../_lib/services/audit";
import {
  passkeyRegisterCompleteRouteSchema,
  passkeyRegisterCompleteSchema,
} from "../../../../../assets/shared/schemas/passkeys";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const actor = await requireAnyActorFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, passkeyRegisterCompleteSchema);

  const passkey = await completePasskeyRegistration(requestDb(c), c.env, actor, {
    challengeToken: body.challengeToken,
    response: body.response,
    deviceName: body.deviceName,
  });

  await writeAuditLog(requestDb(c), actor.kind, actor.id, "passkey_registered", "passkey_credential", passkey.id, {
    deviceName: passkey.deviceName,
  });

  return jsonNoStore(passkey, 201);
}

export class PasskeyRegisterComplete extends OpenAPIRoute {
  schema = passkeyRegisterCompleteRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
