/**
 * PUT /api/v1/me/active-membership — switch which membership context
 * (own individual membership vs. one of possibly several represented
 * organizations) the current session acts as.
 */
import { json } from "../../../_lib/http";
import {
  requireMemberFromRequest,
  switchActiveMembership,
  signMemberSessionToken,
  serializeMemberSessionCookie,
} from "../../../_lib/auth/member";
import { getMyProfile } from "../../../_lib/services/member-self-service";
import { requireInternalSecret } from "../../../_lib/request";
import { myActiveMembershipSwitchRouteSchema } from "../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { openApiRoute } from "../../../_lib/openapi/route";

export const MeActiveMembershipSwitch = openApiRoute(
  myActiveMembershipSwitchRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    const switched = await switchActiveMembership(db, member, data.body.memberId);

    const secret = requireInternalSecret(c.env);
    const token = await signMemberSessionToken(secret, {
      userId: switched.userId,
      sessionId: switched.sessionId!,
      expiresAt: switched.expiresAt!,
      activeMemberId: switched.memberId,
    });

    const profile = await getMyProfile(db, switched);
    const response = json(profile);
    response.headers.append("Set-Cookie", serializeMemberSessionCookie(token, c.req.raw));
    return response;
  },
);
