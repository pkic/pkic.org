import {
  groupVoteMutationResponseSchema,
  groupVoteUpdateRouteSchema,
} from "../../../../../../../assets/shared/schemas/group-vote-management";
import { requireVoteManagementAccess } from "../../../../../../_lib/auth/vote-access";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { updateVoteSettings } from "../../../../../../_lib/services/votes";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../../group-resource-context";

export const GroupVoteSettingsPatch = openApiRoute(groupVoteUpdateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const actor = requireGroupManagementActor(viewer);
  await requireVoteManagementAccess(db, actor, data.params.voteId, group.id);
  const vote = await updateVoteSettings(db, actor, data.params.voteId, data.body, group.id);
  return json(groupVoteMutationResponseSchema.parse({ vote }));
});
