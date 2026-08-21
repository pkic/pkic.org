import { json } from "../../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../../_lib/auth/admin";
import { deletePresentationVersion } from "../../../../../../../../_lib/services/presentation-versions";
import { requestDb, type AdminContext } from "../../../../../../../../_lib/db/context";

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const proposalId = c.req.param("proposalId");
  const versionId = c.req.param("versionId");
  await deletePresentationVersion(requestDb(c), proposalId, versionId, admin.id);

  return json({ success: true });
}
