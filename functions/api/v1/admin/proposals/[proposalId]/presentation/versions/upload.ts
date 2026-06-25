import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import {
  parsePresentationUpload,
  storePresentationFile,
} from "../../../../../../../_lib/services/presentation-versions";
import { recordPresentationUpload } from "../../../../../../../_lib/services/proposals-speaker-profile";
import { writeAuditLog } from "../../../../../../../_lib/services/audit";
import { AppError } from "../../../../../../../_lib/errors";
import { first } from "../../../../../../../_lib/db/queries";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");

  const proposal = await first<{ id: string; status: string }>(
    requestDb(c),
    "SELECT id, status FROM session_proposals WHERE id = ? AND deleted_at IS NULL",
    [proposalId],
  );
  if (!proposal) return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);

  if (proposal.status !== "accepted") {
    return json(
      {
        error: { code: "PROPOSAL_NOT_ACCEPTED", message: "Presentations can only be uploaded for accepted proposals." },
      },
      409,
    );
  }

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured on this instance.");

  const parsed = await parsePresentationUpload(c.req.raw);
  if ("error" in parsed) return json(parsed.error, parsed.status);

  const r2Key = await storePresentationFile(bucket, proposalId, parsed);

  await recordPresentationUpload(requestDb(c), proposalId, r2Key, admin.id, {
    fileName: parsed.name ?? null,
    fileSize: parsed.size,
    mimeType: parsed.type,
  });

  await writeAuditLog(requestDb(c), "admin", admin.id, "presentation_uploaded", "session_proposal", proposalId, {
    r2Key,
    fileName: parsed.name ?? null,
    fileSize: parsed.size,
    mimeType: parsed.type,
  });

  return json({ success: true });
}
