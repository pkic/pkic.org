import {
  groupEventProposalDetailRouteSchema,
  groupEventProposalPatchRouteSchema,
} from "../../../../../../../../../assets/shared/schemas/group-event-proposals";
import { eventProposalDetailResponseSchema } from "../../../../../../../../../assets/shared/schemas/event-proposals";
import { proposalPatchResponseSchema } from "../../../../../../../../../assets/shared/schemas/proposal-management";
import { requireUserBackedAdminFromRequest } from "../../../../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../../../../_lib/auth/proposal-access";
import { getConfig } from "../../../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../_lib/openapi/route";
import { getProposalDetailData } from "../../../../../../../../_lib/services/proposal-detail";
import { editProposal } from "../../../../../../../../_lib/services/proposal-edit";
import {
  prepareGroupEventProposalContextGuard,
  requireGroupEventProposalContext,
} from "../../../../../../../../_lib/services/proposal-group-context";

export const GroupEventProposalDetailGet = openApiRoute(
  groupEventProposalDetailRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
    const context = await requireGroupEventProposalContext(
      db,
      actor,
      data.params.groupId,
      data.params.eventId,
      "proposals:read",
      data.params.proposalId,
    );
    const detail = await getProposalDetailData(db, context.proposalId!);
    if (!detail) throw new Error("Proposal context was resolved without a proposal");
    const [access, config] = await Promise.all([
      getProposalAccessForEvent(db, context.eventId, actor),
      Promise.resolve(getConfig(c.env, c.req.raw)),
    ]);
    return json(
      eventProposalDetailResponseSchema.parse({
        event: detail.event,
        proposal: detail.proposal,
        access,
        form: detail.form,
        minReviewsRequired: config.minProposalReviews,
        sessionTypes: detail.sessionTypes,
      }),
    );
  },
);

export const GroupEventProposalPatch = openApiRoute(
  groupEventProposalPatchRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
    const context = await requireGroupEventProposalContext(
      db,
      actor,
      data.params.groupId,
      data.params.eventId,
      ["proposals:manage", "proposals:edit_accepted_abstract"],
      data.params.proposalId,
    );
    const proposal = await editProposal(db, actor, context.proposalId!, data.body, {
      contextGuard: prepareGroupEventProposalContextGuard(db, context),
    });
    return json(proposalPatchResponseSchema.parse({ proposal }));
  },
);
