import {
  screenGetRouteSchema,
  screenUpdateRouteSchema,
} from "../../../../assets/shared/schemas/route-contracts-event-screens";
import { serializeScreenSessionCookie } from "../../../_lib/auth/screen-session";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../_lib/db/context";
import { json, jsonPrivate } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../_lib/request";
import { updateScreen } from "../../../_lib/services/event-screens/screen-changes";
import { readScreen } from "../../../_lib/services/event-screens/screen-read";

/** The screen reads what to show; staff read its record. */
export const ScreenGet = openApiRoute(screenGetRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { body, renewedToken } = await readScreen(
    requestDb(c),
    c.req.raw,
    c.env,
    requireInternalSecret(c.env),
    data.params.screenId,
  );
  const response = jsonPrivate(body);
  if (renewedToken) response.headers.append("set-cookie", serializeScreenSessionCookie(renewedToken, c.req.raw));
  return response;
});

export const ScreenPatch = openApiRoute(screenUpdateRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  return json(await updateScreen(requestDb(c), c.req.raw, c.env, data.params.screenId, data.body));
});
