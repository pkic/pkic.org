import type { ValidatedData } from "chanfana";
import { finalizeProposalResponseSchema } from "../../../../../../assets/shared/schemas/proposal-management";
import { adminProposalFinalizeRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import { requireUserBackedAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getConfig, resolveAppBaseUrl } from "../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { processSelectedOutboxBackground } from "../../../../../_lib/email/outbox";
import { json } from "../../../../../_lib/http";
import { queuedCapabilityToken } from "../../../../../_lib/services/capability-links";
import { proposalManagePageUrl, speakerManagePageUrl } from "../../../../../_lib/services/frontend-links";
import { finalizeProposalWithNotifications } from "../../../../../_lib/services/proposal-decisions";

export async function onRequestPost(
  c: AdminContext,
  data: ValidatedData<typeof adminProposalFinalizeRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  const proposalId = data.params.proposalId;
  const body = data.body;
  const minReviewsRequired = getConfig(c.env, c.req.raw).minProposalReviews;
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const finalized = await finalizeProposalWithNotifications(
    db,
    {
      proposalId,
      actor: admin,
      finalStatus: body.finalStatus,
      decisionNote: body.decisionNote,
      minReviewsRequired,
      presentationDeadline: body.presentationDeadline,
    },
    {
      appBaseUrl,
      resolveSpeakerManageUrl: async (speaker, event) =>
        speakerManagePageUrl(appBaseUrl, event, queuedCapabilityToken("speaker_manage", speaker.speaker_id)),
      resolveProposalManageUrl: async (event, resourceId) =>
        proposalManagePageUrl(appBaseUrl, event, queuedCapabilityToken("proposal_manage", resourceId)),
    },
  );
  const { outboxIds, ...finalizedResponse } = finalized;
  if (outboxIds.length > 0) {
    c.executionCtx.waitUntil(processSelectedOutboxBackground(c.env.DB, c.env, outboxIds));
  }

  return json(finalizeProposalResponseSchema.parse({ success: true, ...finalizedResponse, minReviewsRequired }));
}
