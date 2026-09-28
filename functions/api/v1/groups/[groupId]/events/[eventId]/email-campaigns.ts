import {
  groupEventEmailCampaignCreateRouteSchema,
  groupEventEmailCampaignPreviewRouteSchema,
} from "../../../../../../../assets/shared/schemas/route-contracts-event-email-campaigns";
import { resolveAppBaseUrl } from "../../../../../../_lib/config";
import type { AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../../../_lib/request";
import {
  createEventEmailCampaign,
  previewEventEmailCampaign,
} from "../../../../../../_lib/services/event-email-campaign";
import { requireManagedGroupEventContext } from "./management-context";

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
    return json(result, 202);
  },
);
