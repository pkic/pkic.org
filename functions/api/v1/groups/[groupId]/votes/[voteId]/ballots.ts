import { groupVoteBallotRouteSchema } from "../../../../../../../assets/shared/schemas/group-votes";
import { submitBallotResponseSchema } from "../../../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { getClientIp, requireInternalSecret } from "../../../../../../_lib/request";
import { submitBallot } from "../../../../../../_lib/services/votes";
import { hmacSha256Hex } from "../../../../../../_lib/utils/crypto";
import { requireGroupResourceContext } from "../../../group-resource-context";

export const GroupVoteBallotsPost = openApiRoute(groupVoteBallotRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const { group, viewer } = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
  const ip = getClientIp(c.req.raw);
  const ipHash = ip ? await hmacSha256Hex(requireInternalSecret(c.env), ip) : null;
  await submitBallot(db, viewer, data.params.voteId, data.body.memberId, data.body.choice, ipHash, group.id);
  return json(submitBallotResponseSchema.parse({ success: true }));
});
