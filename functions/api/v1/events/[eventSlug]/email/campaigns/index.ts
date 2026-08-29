import { eventEmailCampaignCreateRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts-event-email-campaigns";
import { guardPermissionDatabase } from "../../../../../../_lib/auth/permissions";
import { getConfig, resolveAppBaseUrl } from "../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { processPendingOutboxBackground } from "../../../../../../_lib/email/outbox";
import { AppError } from "../../../../../../_lib/errors";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../../../_lib/request";
import { createEventEmailCampaign } from "../../../../../../_lib/services/event-email-campaign";
import { getEventBySlug } from "../../../../../../_lib/services/events";
import { requireEventPermission } from "../../authorization";

const IMMEDIATE_OUTBOX_LIMIT = 100;

export const EventEmailCampaignCreate = openApiRoute(
  eventEmailCampaignCreateRouteSchema,
  async (c: AdminContext, data) => {
    const authorization = await requireEventPermission(c, data.params.eventSlug, "events:write");
    const db = guardPermissionDatabase(
      authorization.db,
      authorization.actor,
      [{ permission: "events:write", context: authorization.context }],
      () => new AppError(409, "EVENT_COMMUNICATION_ACCESS_CHANGED", "Event communication access changed"),
    );
    const event = await getEventBySlug(db, data.params.eventSlug);
    const result = await createEventEmailCampaign(db, event, data.body, {
      actorId: authorization.actor.id,
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
      signingSecret: requireInternalSecret(c.env),
      maxRecipients: getConfig(c.env).eventCampaignMaxRecipients,
    });
    const rawDb = requestDb(c);
    c.executionCtx.waitUntil(
      processPendingOutboxBackground(
        rawDb,
        c.env,
        Math.min(getConfig(c.env).scheduledOutboxLimit, IMMEDIATE_OUTBOX_LIMIT),
      ),
    );
    return json(result, 202);
  },
);
