import { groupDirectoryRouteSchema } from "../../../../../assets/shared/schemas/group-directory";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getPublicGroupDirectory } from "../../../../_lib/services/groups/public-directory";

export const GroupDirectoryGet = openApiRoute(groupDirectoryRouteSchema, async (c: AdminContext, data) => {
  return json(await getPublicGroupDirectory(requestDb(c), data.params.groupId));
});
