import {
  groupEventProposalCommentCreateRouteSchema,
  groupEventProposalCommentsListRouteSchema,
} from "../../../../../../../../../assets/shared/schemas/group-event-proposals";
import { requireUserBackedAdminFromRequest } from "../../../../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../_lib/openapi/route";
import {
  prepareGroupEventProposalContextGuard,
  requireGroupEventProposalContext,
} from "../../../../../../../../_lib/services/proposal-group-context";
import { addProposalComment, listProposalComments } from "../../../../../../../../_lib/services/proposal-comments";

export const GroupEventProposalCommentsList = openApiRoute(
  groupEventProposalCommentsListRouteSchema,
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
    return json(
      await listProposalComments(db, actor, context.proposalId!, {
        q: data.query.q,
        sort: data.query.sort,
        limit: data.query.limit,
        offset: data.query.offset,
      }),
    );
  },
);

export const GroupEventProposalCommentCreate = openApiRoute(
  groupEventProposalCommentCreateRouteSchema,
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
    const comment = await addProposalComment(db, actor, context.proposalId!, data.body.comment, {
      contextGuard: prepareGroupEventProposalContextGuard(db, context),
    });
    return json({ success: true as const, comment });
  },
);
