/**
 * GET /api/v1/portal/votes — every vote visible to the caller:
 * every forum vote, every public vote, plus every vote scoped to a working
 * group the caller belongs to.
 */
import { openApiRoute } from "../../../../_lib/openapi/route";
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { listVisibleVotesForMember } from "../../../../_lib/services/votes";
import { portalVotesListRouteSchema } from "../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export const PortalVotesGet = openApiRoute(portalVotesListRouteSchema, async (c: AdminContext) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const votes = await listVisibleVotesForMember(db, member);
  return json({ votes });
});
