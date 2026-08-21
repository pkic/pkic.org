/**
 * POST /api/v1/auth/passkeys/authenticate/complete.
 *
 * Mirrors admin/auth/verify-link.ts's / member/auth/verify-link.ts's
 * session-issuance response shape exactly (Set-Cookie + {success,
 * expiresAt, admin|member}) so each frontend can reuse its own existing
 * saveAuth()-style handling for both login methods. Which shape comes back
 * depends on which population (staff vs member) the authenticating
 * passkey's owner turned out to be eligible for — see
 * completePasskeyAuthentication's kind-discriminated result.
 */
import {
  createAdminSessionEstablishedResponse,
  createMemberSessionEstablishedResponse,
} from "../../../../_lib/auth/http-flow";
import { requireInternalSecret } from "../../../../_lib/request";
import { completePasskeyAuthentication } from "../../../../_lib/services/passkeys";
import { passkeyAuthenticateCompleteRouteSchema } from "../../../../../assets/shared/schemas/passkeys";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import type { DatabaseSessionLike } from "../../../../_lib/db/session";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const PasskeyAuthenticateComplete = openApiRoute(
  passkeyAuthenticateCompleteRouteSchema,
  async (c: AdminContext, data) => {
    const secret = requireInternalSecret(c.env);
    const body = data.body;
    const db = requestDb(c) as DatabaseSessionLike;

    const verified = await completePasskeyAuthentication(db, c.env, {
      challengeToken: body.challengeToken,
      response: body.response,
    });

    if (verified.kind === "admin") {
      return createAdminSessionEstablishedResponse({
        secret,
        request: c.req.raw,
        admin: verified.admin,
        sessionId: verified.sessionId,
        expiresAt: verified.expiresAt,
        state: db.getBookmark?.(),
      });
    }

    return createMemberSessionEstablishedResponse({
      secret,
      request: c.req.raw,
      member: verified.member,
      sessionId: verified.sessionId,
      expiresAt: verified.expiresAt,
    });
  },
);
