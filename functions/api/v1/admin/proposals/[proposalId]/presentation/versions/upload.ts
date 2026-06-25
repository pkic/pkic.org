import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { createPresentationVersion } from "../../../../../../../_lib/services/presentation-versions";
import { writeAuditLog } from "../../../../../../../_lib/services/audit";
import { AppError } from "../../../../../../../_lib/errors";
import { first } from "../../../../../../../_lib/db/queries";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
]);
const MAX_PRESENTATION_BYTES = 200 * 1024 * 1024;

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

  const contentType = c.req.raw.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return json({ error: { code: "INVALID_CONTENT_TYPE", message: "Request must be multipart/form-data" } }, 400);
  }

  const formData = await c.req.raw.formData();
  const file = formData.get("file");

  if (!file || typeof file === "string") {
    return json({ error: { code: "MISSING_FILE", message: 'A "file" field is required.' } }, 400);
  }

  const blob = file as File;
  const blobType = blob.type || "application/octet-stream";

  if (!ALLOWED_MIME_TYPES.has(blobType)) {
    return json(
      {
        error: {
          code: "INVALID_FILE_TYPE",
          message: "Only PDF and PowerPoint (PPTX/PPT/PPTM/ODP) files are accepted.",
        },
      },
      415,
    );
  }

  if (blob.size > MAX_PRESENTATION_BYTES) {
    return json({ error: { code: "FILE_TOO_LARGE", message: "Presentation must be under 200 MB." } }, 413);
  }

  const safeName = (blob.name ?? "presentation").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const r2Key = `presentations/${proposalId}/${Date.now()}-${safeName}`;

  await bucket.put(r2Key, await blob.arrayBuffer(), { httpMetadata: { contentType: blobType } });

  const version = await createPresentationVersion(requestDb(c), proposalId, {
    r2Key,
    fileName: blob.name ?? null,
    fileSize: blob.size,
    mimeType: blobType,
    uploadedByUserId: admin.id,
  });

  await writeAuditLog(requestDb(c), "admin", admin.id, "presentation_uploaded", "session_proposal", proposalId, {
    r2Key,
    fileName: blob.name ?? null,
    fileSize: blob.size,
    mimeType: blobType,
    versionNumber: version.versionNumber,
  });

  return json({ success: true, version });
}
