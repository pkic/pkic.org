/**
 * DELETE /api/v1/auth/passkeys/:id — PRD §3.4, remove a passkey.
 */
import { OpenAPIRoute } from "chanfana";
import { jsonNoStore } from "../../../../_lib/http";
import { requireAnyActorFromRequest } from "../../../../_lib/auth/actor";
import { revokePasskey } from "../../../../_lib/services/passkeys";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { passkeyDeleteRouteSchema } from "../../../../../assets/shared/schemas/passkeys";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const actor = await requireAnyActorFromRequest(requestDb(c), c.req.raw, c.env);
  const passkeyId = c.req.param("id");

  await revokePasskey(requestDb(c), actor.id, passkeyId);
  await writeAuditLog(requestDb(c), actor.kind, actor.id, "passkey_removed", "passkey_credential", passkeyId, {});

  return jsonNoStore({ success: true });
}

export class PasskeyDelete extends OpenAPIRoute {
  schema = passkeyDeleteRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestDelete(c);
  }
}
