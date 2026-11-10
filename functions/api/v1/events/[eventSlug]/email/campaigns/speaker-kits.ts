import {
  speakerKitDeliveriesRouteSchema,
  speakerKitTestRouteSchema,
} from "../../../../../../../assets/shared/schemas/route-contracts-event-email-campaigns";
import { guardPermissionDatabase } from "../../../../../../_lib/auth/permissions";
import { resolveAppBaseUrl } from "../../../../../../_lib/config";
import type { AdminContext } from "../../../../../../_lib/db/context";
import { AppError } from "../../../../../../_lib/errors";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../../../_lib/request";
import { listSpeakerKitDeliveries, sendSpeakerKitTest } from "../../../../../../_lib/services/event-email-campaign";
import { getEventBySlug } from "../../../../../../_lib/services/events";
import { requireEventPermission } from "../../authorization";

export const SpeakerKitTestCreate = openApiRoute(speakerKitTestRouteSchema, async (c: AdminContext, data) => {
  const authorization = await requireEventPermission(c, data.params.eventSlug, "events:write");
  const db = guardPermissionDatabase(
    authorization.db,
    authorization.actor,
    [{ permission: "events:write", context: authorization.context }],
    () => new AppError(409, "EVENT_COMMUNICATION_ACCESS_CHANGED", "Event communication access changed"),
  );
  const event = await getEventBySlug(db, data.params.eventSlug);
  const result = await sendSpeakerKitTest(db, event, data.body, {
    actorId: authorization.actor.id,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    signingSecret: requireInternalSecret(c.env),
  });
  return json(result, 202);
});

export const SpeakerKitDeliveriesList = openApiRoute(speakerKitDeliveriesRouteSchema, async (c: AdminContext, data) => {
  const authorization = await requireEventPermission(c, data.params.eventSlug, "events:write");
  const event = await getEventBySlug(authorization.db, data.params.eventSlug);
  return json(await listSpeakerKitDeliveries(authorization.db, event.id, data.query));
});
