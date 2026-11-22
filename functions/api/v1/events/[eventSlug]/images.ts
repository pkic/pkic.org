import {
  eventMotifGetRouteSchema,
  eventHeroImageGetRouteSchema,
  eventHeroImageSaveRouteSchema,
} from "../../../../../assets/shared/schemas/event-hero-image";
import { eventManagementDetailResponseSchema } from "../../../../../assets/shared/schemas/event-management";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  currentEventHeroImage,
  currentEventMotif,
  saveEventHeroImage,
} from "../../../../_lib/services/events/hero-image";
import { readAudienceEventBySlug } from "../../../../_lib/services/events/audience-event";

export const EventHeroImagePost = openApiRoute(eventHeroImageSaveRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const db = requestDb(c);
  const event = await saveEventHeroImage(
    db,
    c.env,
    data.params.eventSlug,
    data.query,
    c.req.raw,
    resolveAppBaseUrl(c.env, c.req.raw),
  );
  return json(eventManagementDetailResponseSchema.parse({ event }));
});

export const EventHeroImageGet = openApiRoute(eventHeroImageGetRouteSchema, async (c: AdminContext, data) =>
  currentEventHeroImage(
    requestDb(c),
    c.env,
    data.params.eventSlug,
    data.params.file,
    data.query.width ? { width: data.query.width, origin: new URL(c.req.raw.url).origin } : undefined,
  ),
);

export const EventMotifGet = openApiRoute(eventMotifGetRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { event } = await readAudienceEventBySlug(requestDb(c), c.req.raw, c.env, data.params.eventSlug);
  return currentEventMotif(event);
});
