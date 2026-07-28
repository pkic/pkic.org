/**
 * PATCH /api/v1/admin/consortium/meetings/:meetingId/ics-files/:fileId —
 * update label or activate/deactivate an ICS file (PRD §4.12).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../../../_lib/http";
import { parseJsonBody } from "../../../../../../../_lib/validation";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../../_lib/auth/permissions";
import { updateIcsFile } from "../../../../../../../_lib/services/meeting-calendar";
import {
  meetingIcsFileUpdateSchema,
  consortiumMeetingIcsUpdateRouteSchema,
} from "../../../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(admin, "working-groups:write");

  const body = await parseJsonBody(c.req, meetingIcsFileUpdateSchema);
  const icsFile = await updateIcsFile(
    db,
    c.req.param("meetingId"),
    c.req.param("fileId"),
    { scopeType: "consortium" },
    body,
  );
  return json({ icsFile });
}

export class ConsortiumMeetingIcsUpdatePatch extends OpenAPIRoute {
  schema = consortiumMeetingIcsUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}
