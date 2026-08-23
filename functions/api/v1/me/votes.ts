/**
 * GET /api/v1/me/votes — my vote history. Replaces the
 * stub now that the voting system is built — see
 * votes.ts's listMyVoteHistory.
 */
import { json } from "../../../_lib/http";
import { requireMemberFromRequest } from "../../../_lib/auth/member";
import { listMyVoteHistory } from "../../../_lib/services/votes";
import { myVotesListResponseSchema, myVotesListRouteSchema } from "../../../../assets/shared/schemas/me";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { openApiRoute } from "../../../_lib/openapi/route";

export const MeVotesGet = openApiRoute(myVotesListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const { votes, total } = await listMyVoteHistory(db, member, data.query);
  return json(
    myVotesListResponseSchema.parse({
      votes,
      page: buildPageInfo(data.query.limit, data.query.offset, total, votes.length),
    }),
  );
});
