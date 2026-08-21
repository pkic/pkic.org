import type { ValidatedData } from "chanfana";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { proposalManagePageUrl, speakerManagePageUrl } from "../../../../../_lib/services/frontend-links";
import type { AdminContext } from "../../../../../_lib/db/context";
import { proposalDecisionPreviewResponseSchema } from "../../../../../../assets/shared/schemas/admin-event-proposals";
import { adminProposalFinalizePreviewRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import { previewProposalDecisionEmails } from "../../../../../_lib/services/proposal-decisions";

export async function onRequestPost(
  c: AdminContext,
  data: ValidatedData<typeof adminProposalFinalizePreviewRouteSchema>,
): Promise<Response> {
  // Use the raw DB binding for this read-only endpoint. The session-wrapped
  // requestDb(c) uses primaryFirstDb which creates a D1 session that does not
  // support the parallel queries this handler fires (layout + partials +
  // templates all in concurrent Promise.all calls), causing a hang in dev mode.
  const db = c.env.DB;
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const proposalId = data.params.proposalId;
  const body = data.body;
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const preview = await previewProposalDecisionEmails(
    db,
    {
      proposalId,
      actor: admin,
      finalStatus: body.finalStatus,
      decisionNote: body.decisionNote,
      presentationDeadline: body.presentationDeadline,
    },
    {
      appBaseUrl,
      resolveSpeakerManageUrl: async (_speaker, event) => speakerManagePageUrl(appBaseUrl, event, "preview-token"),
      resolveProposalManageUrl: async (event) => proposalManagePageUrl(appBaseUrl, event, "preview-token"),
    },
  );

  return json(proposalDecisionPreviewResponseSchema.parse(preview));
}
