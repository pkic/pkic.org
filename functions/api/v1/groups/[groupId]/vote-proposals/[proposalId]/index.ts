import {
  groupVoteProposalDetailResponseSchema,
  groupVoteProposalDetailRouteSchema,
  groupVoteProposalMutationResponseSchema,
  groupVoteProposalWithdrawRouteSchema,
} from "../../../../../../../assets/shared/schemas/group-vote-proposals";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { getGroupVoteProposalDetail, withdrawGroupVoteProposal } from "../../../../../../_lib/services/votes";
import { requireGroupParticipantMember, requireGroupResourceContext } from "../../../group-resource-context";

export const GroupVoteProposalGet = openApiRoute(groupVoteProposalDetailRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  return json(
    groupVoteProposalDetailResponseSchema.parse(
      await getGroupVoteProposalDetail(db, viewer, group.id, data.params.proposalId),
    ),
  );
});

export const GroupVoteProposalDelete = openApiRoute(
  groupVoteProposalWithdrawRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    await withdrawGroupVoteProposal(
      db,
      requireGroupParticipantMember(context),
      context.group.id,
      data.params.proposalId,
    );
    return json(groupVoteProposalMutationResponseSchema.parse({ success: true }));
  },
);
