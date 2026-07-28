/**
 * GET /api/v1/working-groups/:wgId/meetings — active meeting series for a
 * working group (PRD §4.12). Public, no auth required. :wgId accepts
 * either the WG UUID or its slug, same convention as GET /working-groups/:id.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../_lib/http";
import { listPublicMeetingSeriesForWg } from "../../../../_lib/services/meeting-calendar";
import { publicWgMeetingsRouteSchema } from "../../../../../assets/shared/schemas/meeting-calendar";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export async function onRequestGet(c: any): Promise<Response> {
  const meetingSeries = await listPublicMeetingSeriesForWg(c.env.DB, c.req.param("wgId"));
  const response = json({ meetingSeries });
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
}

export class WorkingGroupMeetingsGet extends OpenAPIRoute {
  schema = publicWgMeetingsRouteSchema;

  async handle(c: any) {
    return onRequestGet(c);
  }
}
