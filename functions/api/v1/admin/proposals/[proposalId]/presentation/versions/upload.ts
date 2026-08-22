import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import {
  getPresentationProposalContext,
  requirePresentationBucket,
  uploadProposalPresentation,
} from "../../../../../../../_lib/services/presentation-upload";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");

  const proposal = await getPresentationProposalContext(requestDb(c), proposalId);

  await uploadProposalPresentation(requestDb(c), requirePresentationBucket(c.env), c.req.raw, proposal, {
    actor: { type: "admin", admin },
    enforceDeadline: false,
  });

  return json({ success: true });
}
