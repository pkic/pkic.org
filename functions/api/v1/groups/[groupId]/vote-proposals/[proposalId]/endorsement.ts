import {
  groupVoteProposalEndorsementWithdrawRouteSchema,
  groupVoteProposalEndorseResponseSchema,
  groupVoteProposalEndorseRouteSchema,
  groupVoteProposalMutationResponseSchema,
} from "../../../../../../../assets/shared/schemas/group-vote-proposals";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { endorseGroupVoteProposal, withdrawGroupVoteProposalEndorsement } from "../../../../../../_lib/services/votes";
import { requireGroupParticipantMember, requireGroupResourceContext } from "../../../group-resource-context";

export const GroupVoteProposalEndorsePost = openApiRoute(
  groupVoteProposalEndorseRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const result = await endorseGroupVoteProposal(
      db,
      requireGroupParticipantMember(context),
      context.viewer,
      context.group.id,
      data.params.proposalId,
    );
    return json(groupVoteProposalEndorseResponseSchema.parse(result));
  },
);

export const GroupVoteProposalEndorseDelete = openApiRoute(
  groupVoteProposalEndorsementWithdrawRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    await withdrawGroupVoteProposalEndorsement(
      db,
      requireGroupParticipantMember(context),
      context.group.id,
      data.params.proposalId,
    );
    return json(groupVoteProposalMutationResponseSchema.parse({ success: true }));
  },
);
