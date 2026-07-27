/**
 * GET /api/v1/admin/applications/:id/documents — staff view of all
 * documents uploaded for an application (PRD §4.2).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { getMemberApplicationById, listApplicationDocuments } from "../../../../../_lib/services/member-applications";
import { AppError } from "../../../../../_lib/errors";
import { adminApplicationDocumentsListRouteSchema } from "../../../../../../assets/shared/schemas/admin-applications";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "membership:read");

  const applicationId = c.req.param("id");
  const application = await getMemberApplicationById(db, applicationId);
  if (!application) {
    throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
  }

  const documents = await listApplicationDocuments(db, applicationId);
  return json({
    documents: documents.map((d) => ({
      id: d.id,
      filename: d.filename,
      mimeType: d.mime_type,
      fileSizeBytes: d.file_size_bytes,
      uploadedAt: d.uploaded_at,
      uploadedByEmail: d.uploaded_by_email,
    })),
  });
}

export class AdminApplicationDocumentsGet extends OpenAPIRoute {
  schema = adminApplicationDocumentsListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
