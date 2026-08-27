import { groupEventProposalCancelRouteSchema } from "../../../../../../../../../assets/shared/schemas/group-event-proposals";
import { cancelAcceptedProposalResponseSchema } from "../../../../../../../../../assets/shared/schemas/proposal-management";
import { requireUserBackedAdminFromRequest } from "../../../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../../../../../_lib/email/outbox";
import { json } from "../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../_lib/openapi/route";
import { cancelAcceptedProposal } from "../../../../../../../../_lib/services/proposal-cancellation";
import {
  prepareGroupEventProposalContextGuard,
  requireGroupEventProposalContext,
} from "../../../../../../../../_lib/services/proposal-group-context";

export const GroupEventProposalCancel = openApiRoute(
  groupEventProposalCancelRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
    const context = await requireGroupEventProposalContext(
      db,
      actor,
      data.params.groupId,
      data.params.eventId,
      "proposals:cancel_accepted",
      data.params.proposalId,
    );
    const canceled = await cancelAcceptedProposal(
      db,
      actor,
      context.proposalId!,
      data.body.comment,
      resolveAppBaseUrl(c.env, c.req.raw),
      { contextGuard: prepareGroupEventProposalContextGuard(db, context) },
    );
    const { outboxIds, ...response } = canceled;
    for (const outboxId of outboxIds) c.executionCtx.waitUntil(processOutboxByIdBackground(db, c.env, outboxId));
    return json(cancelAcceptedProposalResponseSchema.parse({ success: true, ...response }));
  },
);
