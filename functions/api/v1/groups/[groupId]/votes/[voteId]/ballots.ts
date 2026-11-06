import { groupVoteBallotRouteSchema } from "../../../../../../../assets/shared/schemas/group-votes";
import { submitBallotResponseSchema } from "../../../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { getClientIp, requireInternalSecret } from "../../../../../../_lib/request";
import { submitGroupBallotRequest } from "../../../../../../_lib/services/votes/ballot-submission-request";
import { hmacSha256Hex } from "../../../../../../_lib/utils/crypto";

export const GroupVoteBallotsPost = openApiRoute(groupVoteBallotRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const ip = getClientIp(c.req.raw);
  const ipHash = ip ? await hmacSha256Hex(requireInternalSecret(c.env), ip) : null;
  await submitGroupBallotRequest(db, c.req.raw, c.env, data.params.groupId, data.params.voteId, data.body, ipHash);
  return json(submitBallotResponseSchema.parse({ success: true }));
});
