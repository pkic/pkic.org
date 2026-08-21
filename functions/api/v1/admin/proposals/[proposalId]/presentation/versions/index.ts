import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { listProposalPresentationVersions } from "../../../../../../../_lib/services/presentation-versions";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const versions = await listProposalPresentationVersions(requestDb(c), c.req.param("proposalId"));
  return json({ versions });
}
