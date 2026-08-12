/**
 * GET /api/v1/auth/passkeys, list the authenticated user's passkeys.
 */
import { OpenAPIRoute } from "chanfana";
import { jsonNoStore } from "../../../../_lib/http";
import { requireAnyActorFromRequest } from "../../../../_lib/auth/actor";
import { listPasskeysForUser } from "../../../../_lib/services/passkeys";
import { passkeysListRouteSchema } from "../../../../../assets/shared/schemas/passkeys";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const actor = await requireAnyActorFromRequest(requestDb(c), c.req.raw, c.env);
  const passkeys = await listPasskeysForUser(requestDb(c), actor.id);
  return jsonNoStore({ passkeys });
}

export class PasskeysList extends OpenAPIRoute {
  schema = passkeysListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
