import {
  groupVoteLifecycleTransitionResponseSchema,
  groupVoteLifecycleTransitionRouteSchema,
} from "../../../../../../../assets/shared/schemas/group-vote-management";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { transitionManagedVote } from "../../../../../../_lib/services/votes";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../../group-resource-context";

export const GroupVoteTransitionPost = openApiRoute(
  groupVoteLifecycleTransitionRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const { group } = context;
    const result = await transitionManagedVote(
      db,
      requireGroupManagementActor(context),
      data.params.voteId,
      data.body,
      group.id,
    );
    return json(groupVoteLifecycleTransitionResponseSchema.parse(result));
  },
);
