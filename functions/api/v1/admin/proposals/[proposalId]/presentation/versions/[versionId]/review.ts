import { json } from "../../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../../_lib/auth/admin";
import { requireAuthScope } from "../../../../../../../../_lib/auth/scopes";
import { getPresentationVersion, addVersionReview } from "../../../../../../../../_lib/services/presentation-versions";
import { writeAuditLog } from "../../../../../../../../_lib/services/audit";
import { parseJsonBody } from "../../../../../../../../_lib/validation";
import { requestDb, type AdminContext } from "../../../../../../../../_lib/db/context";
import { z } from "zod";

const reviewSchema = z.object({
  status: z.enum(["approved", "rejected", "needs_revision"]),
  note: z.string().trim().max(4000).nullable().optional(),
});

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requireAuthScope(admin, "presentations:review");

  const proposalId = c.req.param("proposalId");
  const versionId = c.req.param("versionId");
  const body = await parseJsonBody(c.req, reviewSchema);

  const version = await getPresentationVersion(requestDb(c), versionId);
  if (version.proposalId !== proposalId) {
    return json({ error: { message: "Presentation version not found" } }, 404);
  }

  await addVersionReview(requestDb(c), versionId, {
    reviewedByUserId: admin.id,
    status: body.status,
    note: body.note?.trim() || null,
  });

  await writeAuditLog(
    requestDb(c),
    "admin",
    admin.id,
    "presentation_version_reviewed",
    "presentation_version",
    versionId,
    { proposalId: version.proposalId, status: body.status },
  );

  const updated = await getPresentationVersion(requestDb(c), versionId);
  return json({ version: updated });
}
