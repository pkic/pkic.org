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
 * The proposal's presentation_r2_key and presentation_uploaded_at are updated.
 * Speakers can re-upload to replace their submission until the deadline.
 */
import { json, markSensitive } from "../../../../../_lib/http";
import {
  getSpeakerByManageToken,
  recordPresentationUpload,
} from "../../../../../_lib/services/proposals";
import { AppError } from "../../../../../_lib/errors";
import { first } from "../../../../../_lib/db/queries";
import type { PagesContext } from "../../../../../_lib/types";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/vnd.ms-powerpoint", // .ppt
  "application/vnd.oasis.opendocument.presentation", // .odp
  "application/vnd.ms-powerpoint.presentation.macroEnabled.12", // .pptm
]);
const MAX_PRESENTATION_BYTES = 200 * 1024 * 1024; // 200 MB

export async function onRequestPut(context: PagesContext<{ token: string }>): Promise<Response> {
  const { speaker, proposal } = await getSpeakerByManageToken(
    context.env.DB,
    context.params.token,
  );

  if (speaker.status === "declined") {
    return json(
      { error: { code: "SPEAKER_DECLINED", message: "You have declined participation." } },
      403,
    );
  }

  // Only allow presentation uploads after the proposal is accepted.
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

  // Check deadline.
  const deadlineRow = await first<{ presentation_deadline: string | null }>(
    context.env.DB,
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

  const bucket = context.env.SPEAKER_UPLOADS_BUCKET;

  if (!bucket) {
    throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured on this instance.");
  }

  const contentType = context.request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return json(
      { error: { code: "INVALID_CONTENT_TYPE", message: "Request must be multipart/form-data" } },
      400,
    );
  }

  const formData = await context.request.formData();
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
    return json(
      { error: { code: "FILE_TOO_LARGE", message: "Presentation must be under 200 MB." } },
      413,
    );
  }

  const safeName = (blob.name ?? "presentation")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 100);
  const r2Key = `presentations/${proposal.id}/${Date.now()}-${safeName}`;

  await bucket.put(r2Key, await blob.arrayBuffer(), {
    httpMetadata: { contentType: blobType },
  });

  await recordPresentationUpload(context.env.DB, proposal.id, r2Key);

  return json({ success: true, r2Key });
}

export async function onRequest(context: PagesContext<{ token: string }>): Promise<Response> {
  markSensitive(context);
  if (context.request.method === "PUT") return onRequestPut(context);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
