/**
 * POST /api/v1/admin/applications/:id/notes. Never emailed;
 * staff/processor-only.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { addApplicationNoteWithAudit } from "../../../../../_lib/services/membership/applications/communications";
import { applicationNoteCreateRouteSchema } from "../../../../../../assets/shared/schemas/admin-applications";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const ApplicationNotesPost = openApiRoute(applicationNoteCreateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "membership:write");

  const body = data.body;
  const note = await addApplicationNoteWithAudit(db, {
    applicationId: data.params.id,
    actorUserId: admin.id,
    body: body.body,
  });
  return json(note, 201);
});
