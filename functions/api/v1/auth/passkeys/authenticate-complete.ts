/**
 * POST /api/v1/auth/passkeys/authenticate/complete — PRD §3.4.
 *
 * Mirrors admin/auth/verify-link.ts's session-issuance response shape
 * exactly (Set-Cookie + {success, expiresAt, admin}) so the frontend can
 * reuse the same saveAuth() handling for both login methods.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../_lib/http";
import { parseJsonBody } from "../../../../_lib/validation";
import { serializeAdminSessionCookie, signAdminSessionToken } from "../../../../_lib/auth/admin";
import { requireInternalSecret } from "../../../../_lib/request";
import { completePasskeyAuthentication } from "../../../../_lib/services/passkeys";
import { writeAuditLog } from "../../../../_lib/services/audit";
import {
  passkeyAuthenticateCompleteRouteSchema,
  passkeyAuthenticateCompleteSchema,
} from "../../../../../assets/shared/schemas/passkeys";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import type { DatabaseSessionLike } from "../../../../_lib/db/session";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const secret = requireInternalSecret(c.env);
  const body = await parseJsonBody(c.req, passkeyAuthenticateCompleteSchema);
  const db = requestDb(c) as DatabaseSessionLike;

  const verified = await completePasskeyAuthentication(db, c.env, {
    challengeToken: body.challengeToken,
    response: body.response,
  });

  await writeAuditLog(db, "admin", verified.admin.id, "passkey_authenticated", "admin_session", null, {
    expiresAt: verified.expiresAt,
  });

  const token = await signAdminSessionToken(secret, {
    admin: verified.admin,
    sessionId: verified.sessionId,
    expiresAt: verified.expiresAt,
    state: db.getBookmark?.(),
  });

  const response = json({ success: true, expiresAt: verified.expiresAt, admin: verified.admin });
  response.headers.set("cache-control", "no-store, max-age=0");
  response.headers.append("Set-Cookie", serializeAdminSessionCookie(token, c.req.raw));
  return response;
}

export class PasskeyAuthenticateComplete extends OpenAPIRoute {
  schema = passkeyAuthenticateCompleteRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
