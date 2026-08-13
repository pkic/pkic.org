/**
 * GET/PATCH /api/v1/me — my profile.
 */
import { json } from "../../../_lib/http";
import { requireMemberFromRequest } from "../../../_lib/auth/member";
import { getMyProfile, updateMyProfile } from "../../../_lib/services/member-self-service";
import { myProfileGetRouteSchema, myProfileUpdateRouteSchema } from "../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { openApiRoute } from "../../../_lib/openapi/route";

export const MeGet = openApiRoute(myProfileGetRouteSchema, async (c: AdminContext) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const profile = await getMyProfile(db, member);
  return json(profile);
});

export const MePatch = openApiRoute(myProfileUpdateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const profile = await updateMyProfile(db, member, data.body);
  return json(profile);
});
