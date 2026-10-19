import { agendaShiftsGetRouteSchema } from "../../../../../../assets/shared/schemas/event-agenda-shift-list";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listAgendaShifts } from "../../../../../_lib/services/event-agenda/shift-list";
import { authorize } from "./index";

export const AgendaShiftsGet = openApiRoute(agendaShiftsGetRouteSchema, async (c, data) => {
  const { db, event } = await authorize(c, data.params.eventSlug, false);
  return json(await listAgendaShifts(db, event.id, data.query));
});
