/**
 * POST /api/v1/auth/passkeys/register/begin.
 *
 * Requires an existing authenticated session — passkey enrollment is
 * something an already-signed-in actor adds to their account, not a new
 * account-creation path. Accepts either an admin/staff session or a member
 * session (see requireAnyActorFromRequest) —  generalized this
 * from admin-only to also cover members, closing the "member passkey login
 * was never built" gap flagged in notes.
 */
import { OpenAPIRoute } from "chanfana";
import { jsonNoStore } from "../../../../_lib/http";
import { requireAnyActorFromRequest } from "../../../../_lib/auth/actor";
import { beginPasskeyRegistration } from "../../../../_lib/services/passkeys";
import { passkeyRegisterBeginRouteSchema } from "../../../../../assets/shared/schemas/passkeys";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const actor = await requireAnyActorFromRequest(requestDb(c), c.req.raw, c.env);
  const result = await beginPasskeyRegistration(requestDb(c), c.env, actor);
  return jsonNoStore(result);
}

export class PasskeyRegisterBegin extends OpenAPIRoute {
  schema = passkeyRegisterBeginRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
