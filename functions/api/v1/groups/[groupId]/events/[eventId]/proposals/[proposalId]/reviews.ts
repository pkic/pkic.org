import {
  groupEventProposalReviewsListRouteSchema,
  groupEventProposalReviewUpsertRouteSchema,
} from "../../../../../../../../../assets/shared/schemas/group-event-proposals";
import { requireUserBackedAdminFromRequest } from "../../../../../../../../_lib/auth/admin";
import { getConfig } from "../../../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../_lib/openapi/route";
import {
  prepareGroupEventProposalContextGuard,
  requireGroupEventProposalContext,
} from "../../../../../../../../_lib/services/proposal-group-context";
import { listProposalReviews, upsertProposalReview } from "../../../../../../../../_lib/services/proposal-reviews";

export const GroupEventProposalReviewsList = openApiRoute(
  groupEventProposalReviewsListRouteSchema,
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
    const config = getConfig(c.env, c.req.raw);
    return json(
      await listProposalReviews(
        db,
        actor,
        context.proposalId!,
        {
          q: data.query.q,
          sort: data.query.sort,
          recommendation: data.query.recommendation,
          limit: data.query.limit,
          offset: data.query.offset,
        },
        config.minProposalReviews,
      ),
    );
  },
);

export const GroupEventProposalReviewUpsert = openApiRoute(
  groupEventProposalReviewUpsertRouteSchema,
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
    const review = await upsertProposalReview(db, actor, context.proposalId!, data.body, {
      contextGuard: prepareGroupEventProposalContextGuard(db, context),
    });
    return json({ success: true as const, review });
  },
);
