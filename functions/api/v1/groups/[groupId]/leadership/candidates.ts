import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { getGroup, listGroupLeadershipCandidates, requireGroupManagement } from "../../../../../_lib/services/groups";
import { groupLeadershipCandidatesListRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-groups";
import { groupLeadershipCandidatesListResponseSchema } from "../../../../../../assets/shared/schemas/groups";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";

/**
 * Who a manager may appoint, which is not the same list as who is seated.
 *
 * A group whose participation follows from affiliation rather than from a
 * taken seat has an empty roster and every eligible member as a candidate;
 * reading the roster instead is what left the All Members forum's leadership
 * picker with nothing to offer.
 */
export const GroupLeadershipCandidatesList = openApiRoute(
  groupLeadershipCandidatesListRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    const group = await getGroup(db, data.params.groupId);
    if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
    await requireGroupManagement(db, admin, group.id);
    const { candidates, total } = await listGroupLeadershipCandidates(db, group.id, data.query);
    return json(
      groupLeadershipCandidatesListResponseSchema.parse({
        candidates,
        page: buildPageInfo(data.query.limit, data.query.offset, total, candidates.length),
      }),
    );
  },
);
