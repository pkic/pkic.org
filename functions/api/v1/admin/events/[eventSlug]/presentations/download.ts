import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requireAuthScope } from "../../../../../../_lib/auth/scopes";
import { AppError } from "../../../../../../_lib/errors";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { getEventBySlug } from "../../../../../../_lib/services/events";
import {
  eventPresentationArchiveResponse,
  listEventPresentations,
} from "../../../../../../_lib/services/presentation-archive";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requireAuthScope(admin, "proposals:read");

  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) {
    throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File downloads are not configured on this instance.");
  }

  const includeAllVersions = new URL(c.req.raw.url).searchParams.get("versions") === "all";
  const presentations = await listEventPresentations(requestDb(c), event.id, { includeAllVersions });
  if (presentations.length === 0) {
    throw new AppError(404, "PRESENTATIONS_NOT_FOUND", "No presentations were found for this event.");
  }

  return eventPresentationArchiveResponse(bucket, event.slug, presentations, { includeAllVersions });
}
