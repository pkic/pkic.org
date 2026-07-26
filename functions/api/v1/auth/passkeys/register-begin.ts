/**
 * POST /api/v1/auth/passkeys/register/begin — PRD §3.4.
 *
 * Requires an existing authenticated session (same requireAdminFromRequest
 * chokepoint every admin-gated route uses) — passkey enrollment is
 * something an already-signed-in actor adds to their account, not a new
 * account-creation path. See "Phase 3 — Implementation Status" in prd.md
 * for why this scopes passkeys to today's staff-eligible population rather
 * than building separate member auth ahead of Phase 4A.
 */
import { OpenAPIRoute } from "chanfana";
import { jsonNoStore } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { beginPasskeyRegistration } from "../../../../_lib/services/passkeys";
import { passkeyRegisterBeginRouteSchema } from "../../../../../assets/shared/schemas/passkeys";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const result = await beginPasskeyRegistration(requestDb(c), c.env, admin);
  return jsonNoStore(result);
}

export class PasskeyRegisterBegin extends OpenAPIRoute {
  schema = passkeyRegisterBeginRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
