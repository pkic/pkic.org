/**
 * POST /api/v1/auth/passkeys/authenticate/complete.
 *
 * Uses the same session-issuance response shape as the unified human
 * magic-link flow. One identity can hold staff and member capacities
 * simultaneously; the same verified assertion establishes one shared session.
 */
import { createSessionEstablishedResponse } from "../../../../_lib/auth/http-flow";
import { publicUserSession, serializeUserSessionCookie } from "../../../../_lib/auth/user-session";
import { completePasskeyAuthentication } from "../../../../_lib/services/passkeys";
import {
  passkeyAuthenticateCompleteResponseSchema,
  passkeyAuthenticateCompleteRouteSchema,
} from "../../../../../assets/shared/schemas/passkeys";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const PasskeyAuthenticateComplete = openApiRoute(
  passkeyAuthenticateCompleteRouteSchema,
  async (c: AdminContext, data) => {
    const body = data.body;
    const db = requestDb(c);

    const verified = await completePasskeyAuthentication(db, c.env, {
      challengeToken: body.challengeToken,
      response: body.response,
    });

    const response = createSessionEstablishedResponse(
      passkeyAuthenticateCompleteResponseSchema.parse({
        success: true,
        expiresAt: verified.session.expiresAt,
        ...publicUserSession(verified.session),
      }),
      serializeUserSessionCookie(verified.token, c.req.raw),
    );
    return response;
  },
);
