import {
  eventLiveOverlayLayoutDeleteRouteSchema,
  eventLiveOverlayLayoutPutRouteSchema,
  eventLiveOverlayLayoutsGetRouteSchema,
  eventLiveOverlayPositionsDeleteRouteSchema,
  eventLiveOverlayPositionsPutRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-live-overlay-layouts";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { jsonNoStore } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  deleteEventLiveOverlayLayout,
  resetEventLiveOverlayPositions,
  saveEventLiveOverlayLayout,
  saveEventLiveOverlayPositions,
} from "../../../../_lib/services/events/live-overlay-layouts";
import { readEventLiveOverlayLayouts } from "../../../../_lib/services/live-session/overlay-layouts";
import { requireEventPermission } from "./authorization";

export const EventLiveOverlayLayoutsGet = openApiRoute(
  eventLiveOverlayLayoutsGetRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:live_moderate");
    return jsonNoStore(await readEventLiveOverlayLayouts(db, event.id));
  },
);

export const EventLiveOverlayLayoutPut = openApiRoute(
  eventLiveOverlayLayoutPutRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "agenda:live_moderate");
    return jsonNoStore(
      await saveEventLiveOverlayLayout(db, { event, actor, slug: data.params.layoutSlug, request: data.body }),
    );
  },
);

export const EventLiveOverlayLayoutDelete = openApiRoute(
  eventLiveOverlayLayoutDeleteRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "agenda:live_moderate");
    return jsonNoStore(await deleteEventLiveOverlayLayout(db, { event, actor, slug: data.params.layoutSlug }));
  },
);

export const EventLiveOverlayPositionsPut = openApiRoute(
  eventLiveOverlayPositionsPutRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "agenda:live_moderate");
    return jsonNoStore(await saveEventLiveOverlayPositions(db, { event, actor, request: data.body }));
  },
);

export const EventLiveOverlayPositionsDelete = openApiRoute(
  eventLiveOverlayPositionsDeleteRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "agenda:live_moderate");
    return jsonNoStore(await resetEventLiveOverlayPositions(db, { event, actor }));
  },
);
