import {
  eventLiveStudioSetupGetRouteSchema,
  eventLiveStudioSetupPutRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-live-studio-setup";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { jsonNoStore } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { saveEventLiveStudioSetup } from "../../../../_lib/services/events/live-studio-setup";
import { readEventLiveStudioSetup } from "../../../../_lib/services/live-session/studio-setup";
import { requireEventPermission } from "./authorization";

export const EventLiveStudioSetupGet = openApiRoute(
  eventLiveStudioSetupGetRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:live_studio");
    return jsonNoStore(await readEventLiveStudioSetup(db, event.id));
  },
);

export const EventLiveStudioSetupPut = openApiRoute(
  eventLiveStudioSetupPutRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { db, event, actor } = await requireEventPermission(c, data.params.eventSlug, "agenda:live_setup");
    return jsonNoStore(await saveEventLiveStudioSetup(db, { event, actor, request: data.body }));
  },
);
