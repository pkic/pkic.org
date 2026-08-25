/**
 * Deprecated compatibility alias for GET /api/v1/leadership/consortium-chairs.
 *
 * The branch previously exposed this route before the forum-specific model was
 * replaced by the ordinary All Members group. New consumers use the consortium
 * route; keeping this alias avoids surprising branch clients during review.
 */
import { json } from "../../../_lib/http";
import { getForumChairsPublic } from "../../../_lib/services/leadership";
import { forumChairsPublicRouteSchema } from "../../../../assets/shared/schemas/leadership";
import { openApiRoute } from "../../../_lib/openapi/route";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export const ForumChairsPublicGet = openApiRoute(forumChairsPublicRouteSchema, async (c: any) => {
  const chairs = await getForumChairsPublic(c.env.DB);
  const response = json(chairs);
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
});
