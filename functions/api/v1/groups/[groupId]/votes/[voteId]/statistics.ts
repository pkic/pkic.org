import {
  groupVoteStatisticsResponseSchema,
  groupVoteStatisticsRouteSchema,
} from "../../../../../../../assets/shared/schemas/group-vote-statistics";
import { requireVoteManagementAccess } from "../../../../../../_lib/auth/vote-access";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { getVoteStatisticsForManager } from "../../../../../../_lib/services/votes";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../../group-resource-context";

export const GroupVoteStatisticsGet = openApiRoute(groupVoteStatisticsRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const { group } = context;
  const actor = requireGroupManagementActor(context);
  await requireVoteManagementAccess(db, actor, data.params.voteId, group.id);
  return json(
    groupVoteStatisticsResponseSchema.parse(await getVoteStatisticsForManager(db, actor, group.id, data.params.voteId)),
  );
});
