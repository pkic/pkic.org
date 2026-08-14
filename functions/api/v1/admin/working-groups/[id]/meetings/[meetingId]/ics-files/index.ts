/**
 * POST /api/v1/admin/working-groups/:id/meetings/:meetingId/ics-files —
 * upload a new ICS file variant to a working group meeting series.
 * multipart/form-data with 'file', 'label', 'year'.
 */
import { json } from "../../../../../../../../_lib/http";
import { AppError } from "../../../../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../../../../_lib/auth/admin";
import { getWorkingGroupBySlugOrId } from "../../../../../../../../_lib/services/working-groups";
import { uploadIcsFile } from "../../../../../../../../_lib/services/meeting-calendar";
import { readUploadedIcsFile, MAX_ICS_BYTES } from "../../../../../../../../_lib/utils/ics-upload";
import { wgMeetingIcsUploadRouteSchema } from "../../../../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../../../_lib/openapi/route";

// No `body` is declared in wgMeetingIcsUploadRouteSchema (this is a
// multipart/form-data upload, not JSON), so chanfana's getValidatedData()
// never touches the raw request body — readUploadedIcsFile(c.req.raw)
// below remains the only body read, with no double-read risk.
export const WgMeetingIcsUploadPost = openApiRoute(wgMeetingIcsUploadRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const wg = await getWorkingGroupBySlugOrId(db, data.params.id);
  if (!wg) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");

  const bucket = c.env.ASSETS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File uploads are not configured");

  const { buffer, contentType, label, year } = await readUploadedIcsFile(c.req.raw);
  if (buffer.byteLength > MAX_ICS_BYTES) {
    return json(
      { error: { code: "FILE_TOO_LARGE", message: `ICS file must be under ${MAX_ICS_BYTES / (1024 * 1024)} MB.` } },
      413,
    );
  }

  const meetingId = data.params.meetingId;
  const r2Key = `meeting-ics/${meetingId}/${Date.now()}.ics`;
  await bucket.put(r2Key, buffer, { httpMetadata: { contentType: contentType || "text/calendar" } });

  const icsFile = await uploadIcsFile(
    db,
    meetingId,
    { scopeType: "working_group", workingGroupId: wg.id },
    { label, year, r2Key, uploadedByUserId: admin.id },
  );

  return json({ icsFile }, 201);
});
