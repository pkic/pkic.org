/**
 * GET /api/v1/working-groups/:wgId/meetings — active meeting series for a
 * working group. Public, no auth required. :wgId accepts
 * either the WG UUID or its slug, same convention as GET /working-groups/:id.
 */
import { json } from "../../../../_lib/http";
import { listPublicMeetingSeriesForWg } from "../../../../_lib/services/meeting-calendar";
import { publicWgMeetingsRouteSchema } from "../../../../../assets/shared/schemas/meeting-calendar";
import { openApiRoute } from "../../../../_lib/openapi/route";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export const WorkingGroupMeetingsGet = openApiRoute(publicWgMeetingsRouteSchema, async (c: any, data) => {
  const result = await listPublicMeetingSeriesForWg(c.env.DB, data.params.wgId, data.query);
  const response = json(result);
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
});
