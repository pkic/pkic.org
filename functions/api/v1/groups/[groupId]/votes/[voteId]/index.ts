import {
  groupVoteDetailResponseSchema,
  groupVoteDetailRouteSchema,
} from "../../../../../../../assets/shared/schemas/group-votes";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { getGroupVoteDetail } from "../../../../../../_lib/services/votes";
import { requireGroupResourceContext } from "../../../group-resource-context";

export const GroupVoteGet = openApiRoute(groupVoteDetailRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const vote = await getGroupVoteDetail(db, viewer, group.id, data.params.voteId);
  return json(groupVoteDetailResponseSchema.parse({ vote }));
});
