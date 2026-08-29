import { json } from "../../../../../_lib/http";
import { requireMemberFromRequest, switchActiveMembership } from "../../../../../_lib/auth/member";
import {
  getUserSessionToken,
  signUserSessionToken,
  serializeUserSessionCookie,
  verifyUserSessionToken,
} from "../../../../../_lib/auth/user-session";
import { sessionExpiresAtToExp } from "../../../../../_lib/auth/session-engine";
import { getMyProfile } from "../../../../../_lib/services/member-self-service";
import { requireInternalSecret } from "../../../../../_lib/request";
import { myActiveMembershipSwitchRouteSchema } from "../../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const CurrentUserActiveMembershipPut = openApiRoute(
  myActiveMembershipSwitchRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    const switched = await switchActiveMembership(db, member, data.body.memberId);

    const secret = requireInternalSecret(c.env);
    const currentToken = getUserSessionToken(c.req.raw);
    const currentClaims = currentToken ? await verifyUserSessionToken(secret, currentToken) : null;
    const token = await signUserSessionToken(secret, {
      sub: switched.userId,
      sid: switched.sessionId!,
      exp: sessionExpiresAtToExp(switched.expiresAt!),
      memberId: switched.memberId,
      state: currentClaims?.ok ? currentClaims.claims.state : undefined,
    });

    const profile = await getMyProfile(db, switched);
    const response = json(profile);
    response.headers.append("Set-Cookie", serializeUserSessionCookie(token, c.req.raw));
    return response;
  },
);
