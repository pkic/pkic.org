import { groupVoteConsultationResponseRouteSchema } from "../../../../../../../assets/shared/schemas/group-votes";
import { submitConsultationResponseResponseSchema } from "../../../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { submitConsultationResponse } from "../../../../../../_lib/services/votes/consultation-responses";
import { requireGroupParticipantMember, requireGroupResourceContext } from "../../../group-resource-context";

export const GroupVoteResponsesPost = openApiRoute(
  groupVoteConsultationResponseRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const context = await requireGroupResourceContext(db, c.req.raw, c.env, data.params.groupId);
    const viewer = requireGroupParticipantMember(context);
    await submitConsultationResponse(
      db,
      viewer,
      data.params.voteId,
      data.body.memberId,
      data.body.answers as Record<string, never>,
      context.group.id,
    );
    return json(submitConsultationResponseResponseSchema.parse({ success: true }));
  },
);
