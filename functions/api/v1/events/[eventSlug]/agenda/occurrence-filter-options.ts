import { agendaOccurrenceFilterOptionsRouteSchema } from "../../../../../../assets/shared/schemas/agenda-occurrence-filter-options";
import { markResponseSensitive } from "../../../../../_lib/db/context";
import { jsonNoStore } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listAgendaOccurrenceFilterOptions } from "../../../../../_lib/services/event-agenda/occurrence-filter-options";
import { requireEventPermission } from "../authorization";
export const AgendaOccurrenceFilterOptionsGet = openApiRoute(
  agendaOccurrenceFilterOptionsRouteSchema,
  async (c, data) => {
    markResponseSensitive(c);
    const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:read");
    return jsonNoStore(await listAgendaOccurrenceFilterOptions(db, event.id, data.query));
  },
);
