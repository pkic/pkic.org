import {
  groupVoteProposalRejectResponseSchema,
  groupVoteProposalRejectRouteSchema,
} from "../../../../../../../assets/shared/schemas/group-vote-proposals";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../../../_lib/email/outbox";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { rejectGroupVoteProposal } from "../../../../../../_lib/services/votes";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../../group-resource-context";

export const GroupVoteProposalRejectPost = openApiRoute(
  groupVoteProposalRejectRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const result = await rejectGroupVoteProposal(
      db,
      requireGroupManagementActor(context.viewer),
      context.viewer,
      context.group.id,
      data.params.proposalId,
      data.body.reason,
    );
    if (result.outboxId) c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, result.outboxId));
    return json(groupVoteProposalRejectResponseSchema.parse({ proposal: result.proposal }));
  },
);
