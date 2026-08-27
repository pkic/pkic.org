import { groupEventProposalReviewPatchRouteSchema } from "../../../../../../../../../../assets/shared/schemas/group-event-proposals";
import { requireUserBackedAdminFromRequest } from "../../../../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../../_lib/openapi/route";
import {
  prepareGroupEventProposalContextGuard,
  requireGroupEventProposalContext,
} from "../../../../../../../../../_lib/services/proposal-group-context";
import { updateProposalReview } from "../../../../../../../../../_lib/services/proposal-reviews";

export const GroupEventProposalReviewPatch = openApiRoute(
  groupEventProposalReviewPatchRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
    const context = await requireGroupEventProposalContext(
      db,
      actor,
      data.params.groupId,
      data.params.eventId,
      "proposals:score",
      data.params.proposalId,
    );
    const review = await updateProposalReview(db, actor, context.proposalId!, data.params.reviewId, data.body, {
      contextGuard: prepareGroupEventProposalContextGuard(db, context),
    });
    return json({ success: true as const, review });
  },
);
