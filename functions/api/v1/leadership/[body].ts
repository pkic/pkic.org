/**
 * GET /api/v1/leadership/:body — public Board of Directors / Executive
 * Council roster (:body is "board" or "executive_council").
 *
 * Replaces the static content/about/board.md / executive-council.md
 * person-card lists — same pattern as GET /api/v1/working-groups/:id's
 * chair/viceChair fields (members-directory.ts), just for the
 * many-simultaneous-holder Board/EC rosters instead of a single chair slot.
 */
import { OpenAPIRoute } from "chanfana";
import { AppError } from "../../../_lib/errors";
import { json } from "../../../_lib/http";
import { getLeadershipPublic } from "../../../_lib/services/leadership";
import { leadershipBodySchema, leadershipPublicRouteSchema } from "../../../../assets/shared/schemas/leadership";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export async function onRequestGet(c: any): Promise<Response> {
  const parsed = leadershipBodySchema.safeParse(c.req.param("body"));
  if (!parsed.success) {
    throw new AppError(404, "UNKNOWN_BODY", "body must be 'board' or 'executive_council'");
  }

  const roster = await getLeadershipPublic(c.env.DB, parsed.data);
  const response = json(roster);
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
}

export class LeadershipPublicGet extends OpenAPIRoute {
  schema = leadershipPublicRouteSchema;

  async handle(c: any) {
    return onRequestGet(c);
  }
}
