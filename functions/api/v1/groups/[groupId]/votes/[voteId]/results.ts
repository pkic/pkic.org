import {
  groupVoteResultsResponseSchema,
  groupVoteResultsRouteSchema,
} from "../../../../../../../assets/shared/schemas/group-votes";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { getGroupVoteResults } from "../../../../../../_lib/services/votes";
import { requireGroupResourceContext } from "../../../group-resource-context";

export const GroupVoteResultsGet = openApiRoute(groupVoteResultsRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const result = await getGroupVoteResults(db, viewer, group.id, data.params.voteId);
  return json(groupVoteResultsResponseSchema.parse({ result }));
});
