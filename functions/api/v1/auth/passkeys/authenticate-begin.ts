/**
 * GET /api/v1/auth/passkeys/authenticate/begin.
 *
 * No authentication required — this is the usernameless discovery flow the
 * login screen calls before the user has a session.
 */
import { jsonNoStore } from "../../../../_lib/http";
import { beginPasskeyAuthentication } from "../../../../_lib/services/passkeys";
import { passkeyAuthenticateBeginRouteSchema } from "../../../../../assets/shared/schemas/passkeys";
import type { AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const PasskeyAuthenticateBegin = openApiRoute(passkeyAuthenticateBeginRouteSchema, async (c: AdminContext) => {
  const result = await beginPasskeyAuthentication(c.env);
  return jsonNoStore(result);
});
