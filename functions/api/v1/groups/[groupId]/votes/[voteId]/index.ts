import {
  groupVoteDetailResponseSchema,
  groupVoteDetailRouteSchema,
} from "../../../../../../../assets/shared/schemas/group-votes";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { readGroupVoteDetailRequest } from "../../../../../../_lib/services/votes/group-read-request";

export const GroupVoteGet = openApiRoute(groupVoteDetailRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const vote = await readGroupVoteDetailRequest(db, c.req.raw, c.env, data.params.groupId, data.params.voteId);
  return json(groupVoteDetailResponseSchema.parse({ vote }));
});
