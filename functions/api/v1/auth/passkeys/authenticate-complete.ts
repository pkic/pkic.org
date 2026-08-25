/**
 * POST /api/v1/auth/passkeys/authenticate/complete.
 *
 * Mirrors admin/auth/verify-link.ts's / member/auth/verify-link.ts's
 * session-issuance response shape. One identity can hold staff and member
 * capacities simultaneously, in which case both independent session cookies
 * are established by the same verified assertion.
 */
import { createIdentitySessionEstablishedResponse } from "../../../../_lib/auth/http-flow";
import { publicAuthAdmin } from "../../../../_lib/auth/admin-identity";
import { requireInternalSecret } from "../../../../_lib/request";
import { completePasskeyAuthentication } from "../../../../_lib/services/passkeys";
import {
  passkeyAuthenticateCompleteResponseSchema,
  passkeyAuthenticateCompleteRouteSchema,
} from "../../../../../assets/shared/schemas/passkeys";
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

    return createIdentitySessionEstablishedResponse({
      secret,
      request: c.req.raw,
      body: passkeyAuthenticateCompleteResponseSchema.parse({
        success: true,
        expiresAt: verified.expiresAt,
        ...(verified.admin ? { admin: publicAuthAdmin(verified.admin.admin) } : {}),
        ...(verified.member ? { member: verified.member.member } : {}),
      }),
      ...(verified.admin
        ? {
            admin: {
              ...verified.admin,
              state: db.getBookmark?.(),
            },
          }
        : {}),
      ...(verified.member ? { member: verified.member } : {}),
    });
  },
);
