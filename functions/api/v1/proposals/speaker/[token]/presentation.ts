/**
 * Presentation upload endpoint (token-authenticated).
 *
 * PUT /api/v1/proposals/speaker/[token]/presentation
 *   Content-Type: multipart/form-data
 *   Field: "file" — PDF or PowerPoint file (PPTX / ODP / PPTM accepted)
 *
 * The file is stored in the SPEAKER_UPLOADS_BUCKET R2 bucket under:
 *   presentations/{proposalId}/{timestamp}-{originalFilename}
 *
 * Each upload creates a new version in presentation_versions; the previous version is retained.
 * Speakers can re-upload until the deadline.
 */
import { json } from "../../../../../_lib/http";
import { getSpeakerByManageToken } from "../../../../../_lib/services/proposals";
import { recordPresentationUpload } from "../../../../../_lib/services/proposals-speaker-profile";
import { parsePresentationUpload, storePresentationFile } from "../../../../../_lib/services/presentation-versions";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { AppError } from "../../../../../_lib/errors";
import { first } from "../../../../../_lib/db/queries";

export async function onRequestPut(c: any): Promise<Response> {
  const { speaker, proposal } = await getSpeakerByManageToken(c.env.DB, c.req.param("token"));

  if (speaker.status === "declined") {
    return json({ error: { code: "SPEAKER_DECLINED", message: "You have declined participation." } }, 403);
  }

  if (proposal.status !== "accepted") {
    return json(
      {
        error: {
          code: "PROPOSAL_NOT_ACCEPTED",
          message: "Presentations can only be uploaded after the proposal has been accepted.",
        },
      },
      409,
    );
  }

  const deadlineRow = await first<{ presentation_deadline: string | null }>(
    c.env.DB,
    "SELECT presentation_deadline FROM session_proposals WHERE id = ?",
    [proposal.id],
  );
  if (deadlineRow?.presentation_deadline && new Date(deadlineRow.presentation_deadline) < new Date()) {
    return json(
      {
        error: {
          code: "DEADLINE_PASSED",
          message: "The presentation upload deadline has passed. Please contact the organiser.",
        },
      },
      409,
    );
  }

  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured on this instance.");

  const parsed = await parsePresentationUpload(c.req.raw);
  if ("error" in parsed) return json(parsed.error, parsed.status);

  const r2Key = await storePresentationFile(bucket, proposal.id, parsed);

  await recordPresentationUpload(c.env.DB, proposal.id, r2Key, speaker.user_id, {
    fileName: parsed.name ?? null,
    fileSize: parsed.size,
    mimeType: parsed.type,
  });

  await writeAuditLog(c.env.DB, "user", speaker.user_id, "presentation_uploaded", "session_proposal", proposal.id, {
    r2Key,
    fileName: parsed.name ?? null,
    fileSize: parsed.size,
    mimeType: parsed.type,
  });

  return json({ success: true, r2Key });
}

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  if (c.req.raw.method === "PUT") return onRequestPut(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
