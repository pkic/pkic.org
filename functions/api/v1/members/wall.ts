import { memberWallRouteSchema } from "../../../../assets/shared/schemas/members-directory";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listMemberWall } from "../../../_lib/services/membership/member-wall";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export const MembersWallGet = openApiRoute(memberWallRouteSchema, async (c: any, data) => {
  const entries = await listMemberWall(c.env.DB, data.query.memberLimit ?? 200);
  const response = json({ entries });
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
});
