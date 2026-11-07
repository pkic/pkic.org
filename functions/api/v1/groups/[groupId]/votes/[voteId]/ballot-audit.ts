import {
  groupVoteBallotsAuditResponseSchema,
  groupVoteBallotsAuditRouteSchema,
} from "../../../../../../../assets/shared/schemas/group-vote-management";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { readGroupBallotAuditRequest } from "../../../../../../_lib/services/votes/group-read-request";

export const GroupVoteBallotAuditGet = openApiRoute(groupVoteBallotsAuditRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  return json(
    groupVoteBallotsAuditResponseSchema.parse(
      await readGroupBallotAuditRequest(db, c.req.raw, c.env, data.params.groupId, data.params.voteId, data.query),
    ),
  );
});
