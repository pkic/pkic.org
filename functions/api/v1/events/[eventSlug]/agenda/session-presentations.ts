import { publicSessionPresentationContent } from "../../../../../_lib/services/session-presentation-public-release";
import { getStaticAssetsBinding } from "../../../../../_lib/static-assets";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { AppError } from "../../../../../_lib/errors";
import { requireEventPermission } from "../authorization";
import { requirePresentationBucket } from "../../../../../_lib/services/presentation-upload";
import { presentationDownloadResponse } from "../../../../../_lib/services/presentation-versions";
import {
  getSessionPresentation,
  listSessionPresentations,
  reviewSessionPresentation,
  deleteSessionPresentation,
} from "../../../../../_lib/services/event-agenda/session-presentations";
import { uploadSessionPresentation } from "../../../../../_lib/services/event-agenda/session-presentation-upload";
import * as contracts from "../../../../../../assets/shared/schemas/route-contracts-session-presentations";
export const SessionPresentationList = openApiRoute(contracts.sessionPresentationListRouteSchema, async (c, data) => {
  const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "agenda:read");
  return json(
    await listSessionPresentations(
      db,
      { eventId: event.id, occurrenceId: data.params.occurrenceId, actor },
      data.query,
    ),
  );
});
export const SessionPresentationUpload = openApiRoute(
  contracts.sessionPresentationUploadRouteSchema,
  async (c, data) => {
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "agenda:write");
    return json(
      await uploadSessionPresentation(
        db,
        requirePresentationBucket(c.env),
        { eventId: event.id, occurrenceId: data.params.occurrenceId, actor },
        c.req.raw,
      ),
    );
  },
);
export const SessionPresentationReview = openApiRoute(
  contracts.sessionPresentationReviewRouteSchema,
  async (c, data) => {
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "agenda:write");
    return json(
      await reviewSessionPresentation(
        db,
        { eventId: event.id, occurrenceId: data.params.occurrenceId, actor },
        data.params.versionId,
        data.body,
        c.env.SPEAKER_UPLOADS_BUCKET,
      ),
    );
  },
);
export const SessionPresentationDelete = openApiRoute(
  contracts.sessionPresentationDeleteRouteSchema,
  async (c, data) => {
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "agenda:write");
    return json(
      await deleteSessionPresentation(
        db,
        { eventId: event.id, occurrenceId: data.params.occurrenceId, actor },
        data.params.versionId,
        c.env.SPEAKER_UPLOADS_BUCKET,
      ),
    );
  },
);
export const SessionPresentationDownload = openApiRoute(
  contracts.sessionPresentationDownloadRouteSchema,
  async (c, data) => {
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "agenda:read");
    const version = await getSessionPresentation(
      db,
      { eventId: event.id, occurrenceId: data.params.occurrenceId, actor },
      data.params.versionId,
    );
    const object = await requirePresentationBucket(c.env).get(version.r2Key);
    if (!object) throw new AppError(404, "PRESENTATION_OBJECT_NOT_FOUND", "Presentation file not found");
    const response = presentationDownloadResponse(object, version);
    response.headers.set("cache-control", "private, no-store");
    response.headers.set("x-content-type-options", "nosniff");
    return response;
  },
);

export const SessionPresentationPublicRelease = openApiRoute(
  contracts.sessionPresentationPublicReleaseRouteSchema,
  async (c, data) =>
    publicSessionPresentationContent(
      getStaticAssetsBinding(c.env),
      c.env.SPEAKER_UPLOADS_BUCKET,
      c.req.raw,
      data.params,
    ),
);
