import { groupEventProposalFinalizeRouteSchema } from "../../../../../../../../../assets/shared/schemas/group-event-proposals";
import { finalizeProposalResponseSchema } from "../../../../../../../../../assets/shared/schemas/proposal-management";
import { requireUserBackedAdminFromRequest } from "../../../../../../../../_lib/auth/admin";
import { getConfig, resolveAppBaseUrl } from "../../../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../../../_lib/db/context";
import { processSelectedOutboxBackground } from "../../../../../../../../_lib/email/outbox";
import { json } from "../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../_lib/openapi/route";
import { queuedCapabilityToken } from "../../../../../../../../_lib/services/capability-links";
import { proposalManagePageUrl, speakerManagePageUrl } from "../../../../../../../../_lib/services/frontend-links";
import { finalizeProposalWithNotifications } from "../../../../../../../../_lib/services/proposal-decisions";
import {
  prepareGroupEventProposalContextGuard,
  requireGroupEventProposalContext,
} from "../../../../../../../../_lib/services/proposal-group-context";

export const GroupEventProposalFinalize = openApiRoute(
  groupEventProposalFinalizeRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
    const context = await requireGroupEventProposalContext(
      db,
      actor,
      data.params.groupId,
      data.params.eventId,
      "proposals:manage",
      data.params.proposalId,
    );
    const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
    const minReviewsRequired = getConfig(c.env, c.req.raw).minProposalReviews;
    const finalized = await finalizeProposalWithNotifications(
      db,
      {
        proposalId: context.proposalId!,
        actor,
        finalStatus: data.body.finalStatus,
        decisionNote: data.body.decisionNote,
        minReviewsRequired,
        presentationDeadline: data.body.presentationDeadline,
      },
      {
        appBaseUrl,
        resolveSpeakerManageUrl: async (speaker, event) =>
          speakerManagePageUrl(appBaseUrl, event, queuedCapabilityToken("speaker_manage", speaker.speaker_id)),
        resolveProposalManageUrl: async (event, resourceId) =>
          proposalManagePageUrl(appBaseUrl, event, queuedCapabilityToken("proposal_manage", resourceId)),
      },
      { contextGuard: prepareGroupEventProposalContextGuard(db, context) },
    );
    const { outboxIds, ...response } = finalized;
    if (outboxIds.length > 0) {
      c.executionCtx.waitUntil(processSelectedOutboxBackground(c.env.DB, c.env, outboxIds));
    }
    return json(
      finalizeProposalResponseSchema.parse({
        success: true,
        ...response,
        minReviewsRequired,
      }),
    );
  },
);
