/**
 * POST /api/v1/admin/applications/:id/notes. Never emailed;
 * staff/processor-only.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import {
  addApplicationNote,
  getMemberApplicationById,
} from "../../../../../_lib/services/membership/applications/queries";
import { AppError } from "../../../../../_lib/errors";
import { applicationNoteCreateRouteSchema } from "../../../../../../assets/shared/schemas/admin-applications";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const ApplicationNotesPost = openApiRoute(applicationNoteCreateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "membership:write");

  const applicationId = data.params.id;
  const application = await getMemberApplicationById(db, applicationId);
  if (!application) {
    throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
  }

  const body = data.body;
  const note = await addApplicationNote(db, { applicationId, actorUserId: admin.id, body: body.body });

  await writeAuditLog(db, "admin", admin.id, "application_note_added", "member_application", applicationId, {});

  return json({ id: note.id, createdAt: note.created_at }, 201);
});
