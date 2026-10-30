/**
 * DELETE /api/v1/auth/passkeys/:id, remove a passkey.
 */
import { jsonNoStore } from "../../../../_lib/http";
import { requireIdentityFromRequest } from "../../../../_lib/auth/user-session";
import { revokePasskey } from "../../../../_lib/services/passkeys";
import { passkeyDeleteRouteSchema } from "../../../../../assets/shared/schemas/passkeys";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const PasskeyDelete = openApiRoute(passkeyDeleteRouteSchema, async (c: AdminContext, data) => {
  const identity = await requireIdentityFromRequest(requestDb(c), c.req.raw, c.env);

  await revokePasskey(
    requestDb(c),
    { kind: "user", id: identity.userId, sessionId: identity.sessionId },
    data.params.id,
    { confirmLastMethod: data.query.confirmLastMethod },
  );

  return jsonNoStore({ success: true });
});
