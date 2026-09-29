import {
  groupVotesListResponseSchema,
  groupVotesListRouteSchema,
} from "../../../../../../assets/shared/schemas/group-votes";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listGroupVotes } from "../../../../../_lib/services/votes";
import { requireGroupResourceContext } from "../../group-resource-context";

export const GroupVotesList = openApiRoute(groupVotesListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const result = await listGroupVotes(db, viewer, group.id, data.query);
  return json(
    groupVotesListResponseSchema.parse({
      votes: result.votes,
      page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.votes.length),
    }),
  );
});
