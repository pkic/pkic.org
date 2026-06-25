import { json } from "../../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../../_lib/auth/admin";
import { requireAuthScope } from "../../../../../../../../_lib/auth/scopes";
import {
  deletePresentationVersion,
  getPresentationVersion,
} from "../../../../../../../../_lib/services/presentation-versions";
import { writeAuditLog } from "../../../../../../../../_lib/services/audit";
import { requestDb, type AdminContext } from "../../../../../../../../_lib/db/context";

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requireAuthScope(admin, "presentations:delete");

  const proposalId = c.req.param("proposalId");
  const versionId = c.req.param("versionId");
  const version = await getPresentationVersion(requestDb(c), versionId);
  if (version.proposalId !== proposalId) {
    return json({ error: { message: "Presentation version not found" } }, 404);
  }

  await deletePresentationVersion(requestDb(c), versionId);

  await writeAuditLog(
    requestDb(c),
    "admin",
    admin.id,
    "presentation_version_deleted",
    "presentation_version",
    versionId,
    { proposalId: version.proposalId, r2Key: version.r2Key },
  );

  return json({ success: true });
}
