import {
  groupVoteProposalApproveResponseSchema,
  groupVoteProposalApproveRouteSchema,
} from "../../../../../../../assets/shared/schemas/group-vote-proposals";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { approveGroupVoteProposal } from "../../../../../../_lib/services/votes";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../../group-resource-context";

export const GroupVoteProposalApprovePost = openApiRoute(
  groupVoteProposalApproveRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const result = await approveGroupVoteProposal(
      db,
      requireGroupManagementActor(context),
      context.viewer,
      context.group.id,
      data.params.proposalId,
    );
    return json(groupVoteProposalApproveResponseSchema.parse(result));
  },
);
