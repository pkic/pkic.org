import {
  createIdentitySessionEstablishedResponse,
  prepareMagicLinkVerificationHttp,
} from "../../../../_lib/auth/http-flow";
import { publicPortalSession, redeemPortalSignInCapability } from "../../../../_lib/auth/portal";
import { openApiRoute } from "../../../../_lib/openapi/route";
import type { AdminContext } from "../../../../_lib/db/context";
import type { DatabaseSessionLike } from "../../../../_lib/db/session";
import {
  portalAuthVerifyRouteSchema,
  portalSessionEstablishedResponseSchema,
} from "../../../../../assets/shared/schemas/portal-auth";

const PORTAL_MAGIC_LINK_VERIFY_RATE_LIMIT_NAMESPACE = "portal-auth-verify-link:ip";

export const PortalAuthVerifyLink = openApiRoute(portalAuthVerifyRouteSchema, async (c: AdminContext, data) => {
  const http = await prepareMagicLinkVerificationHttp(c, PORTAL_MAGIC_LINK_VERIFY_RATE_LIMIT_NAMESPACE);
  const db = http.db as DatabaseSessionLike;
  const result = await redeemPortalSignInCapability(db, c.env, {
    token: data.body.token,
    signingSecret: http.secret,
    ipHash: http.ipHash,
    userAgentHash: http.userAgentHash,
  });
  const publicSession = publicPortalSession(result);

  return createIdentitySessionEstablishedResponse({
    secret: http.secret,
    request: c.req.raw,
    body: portalSessionEstablishedResponseSchema.parse({
      success: true,
      expiresAt: result.expiresAt,
      ...publicSession,
    }),
    ...(result.adminSession
      ? {
          admin: {
            admin: result.adminSession.value,
            sessionId: result.adminSession.sessionId,
            expiresAt: result.adminSession.expiresAt,
            state: db.getBookmark?.(),
          },
        }
      : {}),
    ...(result.memberSession
      ? {
          member: {
            member: result.memberSession.value,
            sessionId: result.memberSession.sessionId,
            expiresAt: result.memberSession.expiresAt,
          },
        }
      : {}),
  });
});
