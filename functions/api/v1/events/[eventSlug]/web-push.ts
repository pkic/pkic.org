import {
  eventWebPushConfigurationRouteSchema,
  eventWebPushStatusRouteSchema,
  eventWebPushRegisterRouteSchema,
  eventWebPushRevokeRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-event-web-push";
import { eventWebPushConfiguration } from "../../../../_lib/services/event-participation/web-push-configuration";
import {
  eventWebPushStatus,
  registerEventWebPush,
  revokeEventWebPush,
} from "../../../../_lib/services/event-participation/web-push-subscriptions";
import { requireIdentityFromRequest } from "../../../../_lib/auth/user-session";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { getEventBySlug } from "../../../../_lib/services/events";
import { participantSessionDatabase } from "../../../../_lib/services/event-participation/self-authorization";
import { jsonNoStore } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
export const EventWebPushConfigurationGet = openApiRoute(
  eventWebPushConfigurationRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const db = requestDb(c);
    await requireIdentityFromRequest(db, c.req.raw, c.env);
    await getEventBySlug(db, data.params.eventSlug);
    return jsonNoStore(await eventWebPushConfiguration(c.env));
  },
);
export const EventWebPushStatusGet = openApiRoute(eventWebPushStatusRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const db = requestDb(c);
  const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, data.params.eventSlug);
  return jsonNoStore(await eventWebPushStatus(db, event.id, actor.userId, data.params.deviceId));
});
export const EventWebPushRegisterPost = openApiRoute(eventWebPushRegisterRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const db = requestDb(c);
  const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, data.params.eventSlug);
  return jsonNoStore(
    await registerEventWebPush(
      participantSessionDatabase(db, actor.userId, actor.sessionId),
      c.env,
      event.id,
      actor.userId,
      data.body,
    ),
  );
});
export const EventWebPushRevokeDelete = openApiRoute(eventWebPushRevokeRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const db = requestDb(c);
  const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, data.params.eventSlug);
  return jsonNoStore(
    await revokeEventWebPush(
      participantSessionDatabase(db, actor.userId, actor.sessionId),
      event.id,
      actor.userId,
      data.params.deviceId,
    ),
  );
});
