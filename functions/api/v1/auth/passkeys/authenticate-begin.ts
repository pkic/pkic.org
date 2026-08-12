/**
 * GET /api/v1/auth/passkeys/authenticate/begin.
 *
 * No authentication required — this is the usernameless discovery flow the
 * login screen calls before the user has a session.
 */
import { OpenAPIRoute } from "chanfana";
import { jsonNoStore } from "../../../../_lib/http";
import { beginPasskeyAuthentication } from "../../../../_lib/services/passkeys";
import { passkeyAuthenticateBeginRouteSchema } from "../../../../../assets/shared/schemas/passkeys";
import type { AdminContext } from "../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const result = await beginPasskeyAuthentication(c.env);
  return jsonNoStore(result);
}

export class PasskeyAuthenticateBegin extends OpenAPIRoute {
  schema = passkeyAuthenticateBeginRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
