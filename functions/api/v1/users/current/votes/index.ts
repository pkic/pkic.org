import { currentUserVotesListResponseSchema } from "../../../../../../assets/shared/schemas/votes";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { currentUserVotesListRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-user-votes";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listCurrentUserVotesRequest } from "../../../../../_lib/services/votes/current-user-discovery";

export const CurrentUserVotesGet = openApiRoute(currentUserVotesListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const result = await listCurrentUserVotesRequest(db, c.req.raw, c.env, data.query);
  return json(
    currentUserVotesListResponseSchema.parse({
      votes: result.votes,
      page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.votes.length),
    }),
  );
});
