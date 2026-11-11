import {
  eventScreenPairingRouteSchema,
  eventScreensGetRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-event-screens";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { listEventScreens } from "../../../../_lib/services/event-screens/screen-list";
import { approveScreenPairing } from "../../../../_lib/services/event-screens/screen-pairing";

export const EventScreensGet = openApiRoute(eventScreensGetRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  return json(await listEventScreens(requestDb(c), c.req.raw, c.env, data.params.eventSlug, data.query));
});

/** Staff approve the code a screen shows, naming it and optionally assigning it. */
export const EventScreenPairingPost = openApiRoute(eventScreenPairingRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  return json(await approveScreenPairing(requestDb(c), c.req.raw, c.env, data.params.eventSlug, data.body), 201);
});
