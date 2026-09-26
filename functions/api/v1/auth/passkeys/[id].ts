/**
 * DELETE /api/v1/auth/passkeys/:id, remove a passkey.
 */
import { jsonNoStore } from "../../../../_lib/http";
import { requireAnyActorFromRequest } from "../../../../_lib/auth/actor";
import { revokePasskey } from "../../../../_lib/services/passkeys";
import { passkeyDeleteRouteSchema } from "../../../../../assets/shared/schemas/passkeys";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const PasskeyDelete = openApiRoute(passkeyDeleteRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireAnyActorFromRequest(requestDb(c), c.req.raw, c.env);
  const passkeyId = data.params.id;

  await revokePasskey(requestDb(c), actor, passkeyId);

  return jsonNoStore({ success: true });
});
