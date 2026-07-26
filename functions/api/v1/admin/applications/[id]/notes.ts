/**
 * POST /api/v1/admin/applications/:id/notes — PRD §4.2. Never emailed;
 * staff/processor-only.
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { addApplicationNote, getMemberApplicationById } from "../../../../../_lib/services/member-applications";
import { AppError } from "../../../../../_lib/errors";
import {
  applicationNoteCreateRouteSchema,
  applicationNoteCreateSchema,
} from "../../../../../../assets/shared/schemas/admin-applications";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "membership:write");

  const applicationId = c.req.param("id");
  const application = await getMemberApplicationById(db, applicationId);
  if (!application) {
    throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
  }

  const body = await parseJsonBody(c.req, applicationNoteCreateSchema);
  const note = await addApplicationNote(db, { applicationId, actorUserId: admin.id, body: body.body });

  await writeAuditLog(db, "admin", admin.id, "application_note_added", "member_application", applicationId, {});

  return json({ id: note.id, createdAt: note.created_at }, 201);
}

export class ApplicationNotesPost extends OpenAPIRoute {
  schema = applicationNoteCreateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
