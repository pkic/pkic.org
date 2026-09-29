import { groupDirectoryRouteSchema } from "../../../../../assets/shared/schemas/group-directory";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getPublicGroupDirectory } from "../../../../_lib/services/groups/public-directory";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export const GroupDirectoryGet = openApiRoute(groupDirectoryRouteSchema, async (c: AdminContext, data) => {
  const response = json(await getPublicGroupDirectory(requestDb(c), data.params.groupId));
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
});
