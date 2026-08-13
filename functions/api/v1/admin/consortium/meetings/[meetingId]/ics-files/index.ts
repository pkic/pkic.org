/**
 * POST /api/v1/admin/consortium/meetings/:meetingId/ics-files — upload a
 * new ICS file variant to the consortium meeting series.
 * multipart/form-data with 'file', 'label', 'year'.
 */
import { json } from "../../../../../../../_lib/http";
import { AppError } from "../../../../../../../_lib/errors";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../../_lib/auth/permissions";
import { uploadIcsFile } from "../../../../../../../_lib/services/meeting-calendar";
import { readUploadedIcsFile, MAX_ICS_BYTES } from "../../../../../../../_lib/utils/ics-upload";
import { consortiumMeetingIcsUploadRouteSchema } from "../../../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";

export const ConsortiumMeetingIcsUploadPost = openApiRoute(
  consortiumMeetingIcsUploadRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
    requirePermission(admin, "working-groups:write");

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
      { scopeType: "consortium" },
      { label, year, r2Key, uploadedByUserId: admin.id },
    );

    return json({ icsFile }, 201);
  },
);
