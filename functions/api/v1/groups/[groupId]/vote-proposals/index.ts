import {
  groupVoteProposalCreateResponseSchema,
  groupVoteProposalCreateRouteSchema,
  groupVoteProposalsListResponseSchema,
  groupVoteProposalsListRouteSchema,
} from "../../../../../../assets/shared/schemas/group-vote-proposals";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listGroupVoteProposals, submitGroupVoteProposal } from "../../../../../_lib/services/votes";
import { requireGroupParticipantMember, requireGroupResourceContext } from "../../group-resource-context";

export const GroupVoteProposalsList = openApiRoute(groupVoteProposalsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const result = await listGroupVoteProposals(db, viewer, group.id, data.query);
  return json(
    groupVoteProposalsListResponseSchema.parse({
      proposals: result.proposals,
      page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.proposals.length),
    }),
  );
});

export const GroupVoteProposalCreate = openApiRoute(
  groupVoteProposalCreateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const member = requireGroupParticipantMember(context);
    const proposal = await submitGroupVoteProposal(db, member, context.viewer, context.group.id, data.body);
    return json(groupVoteProposalCreateResponseSchema.parse({ proposal }));
  },
);
