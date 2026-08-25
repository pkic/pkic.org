import {
  groupVoteCreateRouteSchema,
  groupVoteMutationResponseSchema,
} from "../../../../../../assets/shared/schemas/group-vote-management";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { requireEffectiveGroupPermission } from "../../../../../_lib/services/groups/governance";
import { createVoteDirect } from "../../../../../_lib/services/votes";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../group-resource-context";

export const GroupVoteCreate = openApiRoute(groupVoteCreateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const actor = requireGroupManagementActor(viewer);
  await requireEffectiveGroupPermission(db, actor, group.id, "votes:create");
  const vote = await createVoteDirect(db, actor, { ...data.body, ownerGroupId: group.id });
  return json(groupVoteMutationResponseSchema.parse({ vote }));
});
