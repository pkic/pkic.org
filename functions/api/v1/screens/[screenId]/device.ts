import { screenDeviceReplaceRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-event-screens";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { replaceScreenDevice } from "../../../../_lib/services/event-screens/screen-device-replacement";

/** Staff approve the code a new device shows, and the screen moves to it under the device's screen ID. */
export const ScreenDevicePut = openApiRoute(screenDeviceReplaceRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  return json(await replaceScreenDevice(requestDb(c), c.req.raw, c.env, data.params.screenId, data.body));
});
