import { eventAnalyticsResponseSchema } from "../../../../../assets/shared/schemas/event-analytics";
import { eventAnalyticsRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-events";
import { hasPermission } from "../../../../_lib/auth/permissions";
import type { AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getEventAnalytics } from "../../../../_lib/services/events/analytics";
import { requireEventPermission } from "./authorization";

export const EventAnalyticsGet = openApiRoute(eventAnalyticsRouteSchema, async (c: AdminContext, data) => {
  const { actor, context, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:read");
  return json(
    eventAnalyticsResponseSchema.parse(
      await getEventAnalytics(db, event, {
        includeProposalStats: hasPermission(actor, "proposals:read", context),
      }),
    ),
  );
});
