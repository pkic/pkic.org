import { memberWallRouteSchema } from "../../../../assets/shared/schemas/members-directory";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listMemberWall } from "../../../_lib/services/membership/member-wall";

export const MembersWallGet = openApiRoute(memberWallRouteSchema, async (c: any, data) => {
  const entries = await listMemberWall(c.env.DB, data.query.memberLimit ?? 200);
  return json({ entries });
});
