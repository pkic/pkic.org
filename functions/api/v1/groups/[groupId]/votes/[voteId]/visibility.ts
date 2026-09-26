import {
  groupVoteMutationResponseSchema,
  groupVoteVisibilityUpdateRouteSchema,
} from "../../../../../../../assets/shared/schemas/group-vote-management";
import { requireVoteManagementAccess } from "../../../../../../_lib/auth/vote-access";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { updateVoteVisibility } from "../../../../../../_lib/services/votes";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../../group-resource-context";

export const GroupVoteVisibilityPatch = openApiRoute(
  groupVoteVisibilityUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const { group } = context;
    const actor = requireGroupManagementActor(context);
    await requireVoteManagementAccess(db, actor, data.params.voteId, group.id);
    const vote = await updateVoteVisibility(db, actor, data.params.voteId, data.body, group.id);
    return json(groupVoteMutationResponseSchema.parse({ vote }));
  },
);
