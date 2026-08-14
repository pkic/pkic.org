/**
 * GET /api/v1/me/calendar/:seriesId/:icsFileId — download a specific ICS
 * file. Lets a member re-download any active variant for a
 * series they're subscribed to at any time, not just at onboarding.
 */
import { AppError } from "../../../../../_lib/errors";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { getMyIcsFileForDownload } from "../../../../../_lib/services/meeting-calendar";
import { myCalendarDownloadRouteSchema } from "../../../../../../assets/shared/schemas/meeting-calendar";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const MeCalendarDownloadGet = openApiRoute(myCalendarDownloadRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const file = await getMyIcsFileForDownload(db, member, data.params.seriesId, data.params.icsFileId);

  const bucket = c.env.ASSETS_BUCKET;
  if (!bucket) throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "Asset storage is not configured");

  const obj = await bucket.get(file.r2_key);
  if (!obj) throw new AppError(404, "ICS_FILE_NOT_FOUND", "ICS file missing from storage");

  const filenameLabel = file.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return new Response(await obj.arrayBuffer(), {
    headers: {
      "Content-Type": "text/calendar",
      "Content-Disposition": `attachment; filename="${filenameLabel || "meeting"}-${file.year}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
});
