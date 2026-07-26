/**
 * POST/GET /api/v1/members/applications/:id/documents?token=...
 *
 * Token-gated document upload/list for a membership applicant (PRD §1.2,
 * §2.3 application_documents). Reuses ASSETS_BUCKET (env.ASSETS_BUCKET) —
 * the codebase's general-purpose R2 bucket — rather than provisioning a
 * dedicated bucket, since that requires an out-of-band Cloudflare dashboard
 * change outside the scope of this migration. r2Key convention per PRD
 * §2.3: application-docs/{application_id}/{uuid}-{filename}.
 */
import { OpenAPIRoute } from "chanfana";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { uuid } from "../../../../../_lib/utils/ids";
import {
  verifyApplicationManageToken,
  listApplicationDocuments,
  recordApplicationDocument,
} from "../../../../../_lib/services/member-applications";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import {
  applicationDocumentListRouteSchema,
  applicationDocumentUploadRouteSchema,
} from "../../../../../../assets/shared/schemas/member-applications";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024; // 20 MB

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "document";
}

async function requireApplication(c: any) {
  const db = c.env.DB;
  const applicationId = c.req.param("id");
  const token = new URL(c.req.raw.url).searchParams.get("token");
  if (!token) {
    throw new AppError(401, "AUTH_INVALID", "Missing token");
  }
  const application = await verifyApplicationManageToken(db, applicationId, token);
  if (!application) {
    throw new AppError(401, "AUTH_INVALID", "Invalid application id or token");
  }
  return application;
}

export async function onRequestPost(c: any): Promise<Response> {
  c.set("sensitive", true);
  const application = await requireApplication(c);

  const bucket = c.env.ASSETS_BUCKET;
  if (!bucket) {
    throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");
  }

  const contentType = (c.req.raw.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("multipart/form-data")) {
    throw new AppError(400, "INVALID_CONTENT_TYPE", "Expected multipart/form-data");
  }

  const formData = await c.req.raw.formData();
  const file = formData.get("file");
  if (!(file instanceof File) && !(file && typeof file === "object" && "arrayBuffer" in file)) {
    throw new AppError(400, "MISSING_FILE", "No file provided under the 'file' field");
  }
  const blob = file as File;

  const mimeType = blob.type || "application/octet-stream";
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", `Unsupported file type: ${mimeType}`);
  }
  if (blob.size > MAX_DOCUMENT_BYTES) {
    throw new AppError(413, "FILE_TOO_LARGE", `File exceeds the ${MAX_DOCUMENT_BYTES / (1024 * 1024)}MB limit`);
  }

  const safeName = sanitizeFilename(blob.name ?? "document");
  const r2Key = `application-docs/${application.id}/${uuid()}-${safeName}`;
  await bucket.put(r2Key, await blob.arrayBuffer(), { httpMetadata: { contentType: mimeType } });

  const document = await recordApplicationDocument(c.env.DB, {
    applicationId: application.id,
    uploadedByEmail: application.applicant_email,
    r2Key,
    filename: safeName,
    mimeType,
    fileSizeBytes: blob.size,
  });

  await writeAuditLog(c.env.DB, "public", null, "application_document_uploaded", "member_application", application.id, {
    filename: safeName,
    fileSize: blob.size,
    mimeType,
  });

  return json(
    {
      document: {
        id: document.id,
        filename: document.filename,
        mimeType: document.mime_type,
        fileSizeBytes: document.file_size_bytes,
        uploadedAt: document.uploaded_at,
      },
    },
    201,
  );
}

export async function onRequestGet(c: any): Promise<Response> {
  c.set("sensitive", true);
  const application = await requireApplication(c);
  const documents = await listApplicationDocuments(c.env.DB, application.id);

  return json({
    documents: documents.map((d) => ({
      id: d.id,
      filename: d.filename,
      mimeType: d.mime_type,
      fileSizeBytes: d.file_size_bytes,
      uploadedAt: d.uploaded_at,
    })),
  });
}

export class MembersApplicationsDocumentsPost extends OpenAPIRoute {
  schema = applicationDocumentUploadRouteSchema;

  async handle(c: any) {
    return onRequestPost(c);
  }
}

export class MembersApplicationsDocumentsGet extends OpenAPIRoute {
  schema = applicationDocumentListRouteSchema;

  async handle(c: any) {
    return onRequestGet(c);
  }
}
