/**
 * GET /api/v1/portal/votes — every vote visible to the caller:
 * every forum vote, every public vote, plus every vote scoped to a working
 * group the caller belongs to.
 */
import { openApiRoute } from "../../../../_lib/openapi/route";
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { listVisibleVotesForMember } from "../../../../_lib/services/votes";
import { portalVotesListResponseSchema, portalVotesListRouteSchema } from "../../../../../assets/shared/schemas/votes";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export const PortalVotesGet = openApiRoute(portalVotesListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const { votes, total } = await listVisibleVotesForMember(db, member, data.query);
  return json(
    portalVotesListResponseSchema.parse({
      votes,
      page: buildPageInfo(data.query.limit, data.query.offset, total, votes.length),
    }),
  );
});
