import { eventBadgePrintPopulationRouteSchema } from "../../../../../../../../assets/shared/schemas/event-badge-printing";
import { type AdminContext } from "../../../../../../../_lib/db/context";
import { jsonNoStore } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { listBadgePrintPopulation } from "../../../../../../../_lib/services/registrations/badge-print-population";
import { requireManagedGroupEventContext } from "../management-context";

export const GroupEventBadgePrintPopulation = openApiRoute(
  eventBadgePrintPopulationRouteSchema,
  async (c: AdminContext, data) => {
    const context = await requireManagedGroupEventContext(c, data.params.groupId, data.params.eventId);
    const population = await listBadgePrintPopulation(context.db, context.event.id, data.query);
    return jsonNoStore(population);
  },
);
