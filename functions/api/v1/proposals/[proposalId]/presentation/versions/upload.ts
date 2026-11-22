import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import {
  getPresentationProposalContext,
  requirePresentationBucket,
  uploadProposalPresentation,
} from "../../../../../../_lib/services/presentation-upload";
import { checkUploadedPresentation } from "../../../../../../_lib/services/content-checks/presentation-checks";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");

  const proposal = await getPresentationProposalContext(requestDb(c), proposalId);

  const uploaded = await uploadProposalPresentation(
    requestDb(c),
    requirePresentationBucket(c.env),
    c.req.raw,
    proposal,
    {
      actor: { type: "admin", admin },
      enforceDeadline: false,
    },
  );

  c.executionCtx.waitUntil(checkUploadedPresentation(c.env, uploaded.versionId));
  return json({ success: true });
}
