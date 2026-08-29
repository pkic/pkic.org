import { eventPresentationArchiveRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-events";
import type { AdminContext } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  eventPresentationArchiveResponse,
  listEventPresentations,
} from "../../../../../_lib/services/presentation-archive";
import { requireEventPermission } from "../authorization";

export const EventPresentationArchiveGet = openApiRoute(
  eventPresentationArchiveRouteSchema,
  async (c: AdminContext, data) => {
    const { db, event } = await requireEventPermission(c, data.params.eventSlug, "proposals:read");
    const bucket = c.env.SPEAKER_UPLOADS_BUCKET;
    if (!bucket) {
      throw new AppError(503, "UPLOADS_NOT_CONFIGURED", "File downloads are not configured on this instance.");
    }

    const includeAllVersions = data.query.versions === "all";
    const presentations = await listEventPresentations(db, event.id, { includeAllVersions });
    if (presentations.length === 0) {
      throw new AppError(404, "PRESENTATIONS_NOT_FOUND", "No presentations were found for this event.");
    }
    return eventPresentationArchiveResponse(bucket, event.slug, presentations, { includeAllVersions });
  },
);
