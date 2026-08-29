import {
  groupEventEmailCampaignCreateRouteSchema,
  groupEventEmailCampaignPreviewRouteSchema,
} from "../../../../../../../assets/shared/schemas/route-contracts-event-email-campaigns";
import { getConfig, resolveAppBaseUrl } from "../../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { processPendingOutboxBackground } from "../../../../../../_lib/email/outbox";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../../../_lib/request";
import {
  createEventEmailCampaign,
  previewEventEmailCampaign,
} from "../../../../../../_lib/services/event-email-campaign";
import {
  guardEventResourceManagementDatabase,
  requireEventResourceManagementContext,
} from "../../../../../../_lib/services/event-series/management";
import { getEventById } from "../../../../../../_lib/services/events";
import { requireGroupManagementActor, requireGroupResourceContext } from "../../../group-resource-context";

const IMMEDIATE_OUTBOX_LIMIT = 100;

async function campaignContext(c: AdminContext, groupId: string, eventId: string) {
  const rawDb = requestDb(c);
  const groupContext = await requireGroupResourceContext(rawDb, c.req.raw, c.env, groupId);
  const actor = requireGroupManagementActor(groupContext);
  const eventContext = await requireEventResourceManagementContext(
    rawDb,
    actor,
    groupContext.group.id,
    eventId,
    "manage",
  );
  const db = guardEventResourceManagementDatabase(rawDb, actor, eventContext, "manage");
  return { actor, db, event: await getEventById(db, eventId), rawDb };
}

export const GroupEventEmailCampaignPreviewCreate = openApiRoute(
  groupEventEmailCampaignPreviewRouteSchema,
  async (c: AdminContext, data) => {
    const context = await campaignContext(c, data.params.groupId, data.params.eventId);
    return json(
      await previewEventEmailCampaign(context.db, context.event, data.body, {
        actorId: context.actor.id,
        appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
        signingSecret: requireInternalSecret(c.env),
        maxRecipients: getConfig(c.env).eventCampaignMaxRecipients,
      }),
    );
  },
);

export const GroupEventEmailCampaignCreate = openApiRoute(
  groupEventEmailCampaignCreateRouteSchema,
  async (c: AdminContext, data) => {
    const context = await campaignContext(c, data.params.groupId, data.params.eventId);
    const result = await createEventEmailCampaign(context.db, context.event, data.body, {
      actorId: context.actor.id,
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
      signingSecret: requireInternalSecret(c.env),
      maxRecipients: getConfig(c.env).eventCampaignMaxRecipients,
    });
    c.executionCtx.waitUntil(
      processPendingOutboxBackground(
        context.rawDb,
        c.env,
        Math.min(getConfig(c.env).scheduledOutboxLimit, IMMEDIATE_OUTBOX_LIMIT),
      ),
    );
    return json(result, 202);
  },
);
