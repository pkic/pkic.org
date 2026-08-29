/**
 * POST /api/v1/members/applications/:id/notes. Never emailed;
 * staff/processor-only.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { addApplicationNoteWithAudit } from "../../../../../_lib/services/membership/applications/communications";
import {
  applicationNoteCreateResponseSchema,
  applicationNoteCreateRouteSchema,
} from "../../../../../../assets/shared/schemas/membership-application-management";
import type { AdminContext } from "../../../../../_lib/db/context";
import { requireStaffPermission } from "../../../../../_lib/auth/staff-permissions";

export const ApplicationNotesPost = openApiRoute(applicationNoteCreateRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireStaffPermission(c, "membership:write");

  const body = data.body;
  const note = await addApplicationNoteWithAudit(db, {
    applicationId: data.params.id,
    actor: staff,
    body: body.body,
  });
  return json(applicationNoteCreateResponseSchema.parse(note), 201);
});
