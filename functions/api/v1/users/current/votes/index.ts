import { currentUserVotesListResponseSchema } from "../../../../../../assets/shared/schemas/votes";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { currentUserVotesListRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-user-votes";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listVisibleVotesForMember } from "../../../../../_lib/services/votes";

export const CurrentUserVotesGet = openApiRoute(currentUserVotesListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const result = await listVisibleVotesForMember(db, member, data.query);
  return json(
    currentUserVotesListResponseSchema.parse({
      votes: result.votes,
      page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.votes.length),
    }),
  );
});
