/**
 * GET /api/v1/auth/passkeys — PRD §3.4, list the authenticated user's passkeys.
 */
import { OpenAPIRoute } from "chanfana";
import { jsonNoStore } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { listPasskeysForUser } from "../../../../_lib/services/passkeys";
import { passkeysListRouteSchema } from "../../../../../assets/shared/schemas/passkeys";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const passkeys = await listPasskeysForUser(requestDb(c), admin.id);
  return jsonNoStore({ passkeys });
}

export class PasskeysList extends OpenAPIRoute {
  schema = passkeysListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
