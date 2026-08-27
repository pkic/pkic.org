import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { hasPermission } from "../../../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { getAdminEventStats } from "../../../../../_lib/services/admin-event-stats";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { adminEventStatsResponseSchema } from "../../../../../../assets/shared/schemas/admin-analytics";
import { adminEventStatsRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-admin-events";

export const AdminEventsEventSlugStatsGet = openApiRoute(adminEventStatsRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, data.params.eventSlug);
  return json(
    adminEventStatsResponseSchema.parse(
      await getAdminEventStats(db, event, {
        includeProposalStats: hasPermission(actor, "proposals:read", { type: "event", id: event.id }),
      }),
    ),
  );
});
