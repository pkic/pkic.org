import { groupEventProposalFinalizePreviewRouteSchema } from "../../../../../../../../../assets/shared/schemas/group-event-proposals";
import { proposalDecisionPreviewResponseSchema } from "../../../../../../../../../assets/shared/schemas/proposal-decisions";
import { requireUserBackedAdminFromRequest } from "../../../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../_lib/openapi/route";
import { proposalManagePageUrl, speakerManagePageUrl } from "../../../../../../../../_lib/services/frontend-links";
import { previewProposalDecisionEmails } from "../../../../../../../../_lib/services/proposal-decisions";
import { requireGroupEventProposalContext } from "../../../../../../../../_lib/services/proposal-group-context";

export const GroupEventProposalFinalizePreview = openApiRoute(
  groupEventProposalFinalizePreviewRouteSchema,
  async (c: AdminContext, data) => {
    const requestSession = requestDb(c);
    const actor = await requireUserBackedAdminFromRequest(requestSession, c.req.raw, c.env);
    const context = await requireGroupEventProposalContext(
      requestSession,
      actor,
      data.params.groupId,
      data.params.eventId,
      "proposals:manage",
      data.params.proposalId,
    );
    const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
    // Template rendering performs parallel layout, partial, and template reads.
    // A D1 session serializes those reads and hangs in local development, so
    // use the raw binding after the authenticated path context has been checked.
    const preview = await previewProposalDecisionEmails(
      c.env.DB,
      {
        proposalId: context.proposalId!,
        actor,
        finalStatus: data.body.finalStatus,
        decisionNote: data.body.decisionNote,
        presentationDeadline: data.body.presentationDeadline,
      },
      {
        appBaseUrl,
        resolveSpeakerManageUrl: async (_speaker, event) => speakerManagePageUrl(appBaseUrl, event, "preview-token"),
        resolveProposalManageUrl: async (event) => proposalManagePageUrl(appBaseUrl, event, "preview-token"),
      },
    );
    return json(proposalDecisionPreviewResponseSchema.parse(preview));
  },
);
