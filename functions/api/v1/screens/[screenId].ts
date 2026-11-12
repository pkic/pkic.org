import {
  screenDeleteRouteSchema,
  screenGetRouteSchema,
  screenUpdateRouteSchema,
} from "../../../../assets/shared/schemas/route-contracts-event-screens";
import { serializeScreenSessionCookie } from "../../../_lib/auth/screen-session";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../_lib/db/context";
import { json, jsonPrivate, noContent } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../_lib/request";
import { removeScreen, updateScreen } from "../../../_lib/services/event-screens/screen-changes";
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
    data.query.agendaRevision ?? null,
  );
  const response = jsonPrivate(body);
  if (renewedToken) response.headers.append("set-cookie", serializeScreenSessionCookie(renewedToken, c.req.raw));
  return response;
});

export const ScreenPatch = openApiRoute(screenUpdateRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  return json(await updateScreen(requestDb(c), c.req.raw, c.env, data.params.screenId, data.body));
});

/** Staff remove a screen that is not signed in, such as one revoked after its device was replaced. */
export const ScreenDelete = openApiRoute(screenDeleteRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  await removeScreen(requestDb(c), c.req.raw, c.env, data.params.screenId);
  return noContent();
});
