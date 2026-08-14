/**
 * GET /api/v1/leadership/forum-chairs — public PKIC forum chair/vice chair.
 *
 * Resolved from role-forum_chair/role-forum_vice_chair (migration 0040),
 * the same global-context roles the admin Leadership tab's "Forum" card
 * assigns. Replaces the static "Chair and Vice Chair" section of
 * content/about/_index.md, which previously hardcoded names/dates that had
 * no connection to those admin-managed role assignments.
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
