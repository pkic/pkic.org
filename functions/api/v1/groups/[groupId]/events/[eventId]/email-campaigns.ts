import {
  groupEventEmailCampaignCreateRouteSchema,
  groupEventEmailCampaignPreviewRouteSchema,
} from "../../../../../../../assets/shared/schemas/route-contracts-event-email-campaigns";
import { getConfig, resolveAppBaseUrl } from "../../../../../../_lib/config";
import type { AdminContext } from "../../../../../../_lib/db/context";
import { processPendingOutboxBackground } from "../../../../../../_lib/email/outbox";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../../../_lib/request";
import {
  createEventEmailCampaign,
  previewEventEmailCampaign,
} from "../../../../../../_lib/services/event-email-campaign";
import { requireManagedGroupEventContext } from "./management-context";

const IMMEDIATE_OUTBOX_LIMIT = 100;

export const GroupEventEmailCampaignPreviewCreate = openApiRoute(
  groupEventEmailCampaignPreviewRouteSchema,
  async (c: AdminContext, data) => {
    const context = await requireManagedGroupEventContext(c, data.params.groupId, data.params.eventId);
    return json(
      await previewEventEmailCampaign(context.db, context.event, data.body, {
        actorId: context.actor.id,
        appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
        signingSecret: requireInternalSecret(c.env),
      }),
    );
  },
);

export const GroupEventEmailCampaignCreate = openApiRoute(
  groupEventEmailCampaignCreateRouteSchema,
  async (c: AdminContext, data) => {
    const context = await requireManagedGroupEventContext(c, data.params.groupId, data.params.eventId);
    const result = await createEventEmailCampaign(context.db, context.event, data.body, {
      actorId: context.actor.id,
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
      signingSecret: requireInternalSecret(c.env),
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
