import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { AppError } from "../../../../../../_lib/errors";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { getEventBySlug } from "../../../../../../_lib/services/events";
import {
  eventPresentationArchiveResponse,
  listEventPresentations,
} from "../../../../../../_lib/services/presentation-archive";
import {
  eventPresentationArchiveDownloadRouteSchema,
  eventPresentationArchiveQuerySchema,
} from "../../../../../../../assets/shared/schemas/admin-events";
import { openApiRoute } from "../../../../../../_lib/openapi/route";

async function downloadPresentations(
  c: AdminContext,
  eventSlug: string,
  includeAllVersions: boolean,
): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), eventSlug);
  requirePermission(admin, "proposals:read", { type: "event", id: event.id });
  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) {
    throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File downloads are not configured on this instance.");
  }

  const presentations = await listEventPresentations(requestDb(c), event.id, { includeAllVersions });
  if (presentations.length === 0) {
    throw new AppError(404, "PRESENTATIONS_NOT_FOUND", "No presentations were found for this event.");
  }

  return eventPresentationArchiveResponse(bucket, event.slug, presentations, { includeAllVersions });
}

export const AdminEventPresentationsDownloadGet = openApiRoute(
  eventPresentationArchiveDownloadRouteSchema,
  (c: AdminContext, data) => downloadPresentations(c, data.params.eventSlug, data.query.versions === "all"),
);

/** Compatibility export for focused service tests; production uses the validated OpenAPI route above. */
export async function onRequestGet(c: AdminContext): Promise<Response> {
  const query = eventPresentationArchiveQuerySchema.parse(Object.fromEntries(new URL(c.req.raw.url).searchParams));
  return downloadPresentations(c, c.req.param("eventSlug"), query.versions === "all");
}
