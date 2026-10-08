import { agendaSponsorChoicesRouteSchema } from "../../../../../../assets/shared/schemas/event-agenda-sponsors";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { listAgendaSponsorChoices } from "../../../../../_lib/services/event-agenda/sponsors";
import { authorize } from "./index";

export const AgendaSponsorChoicesGet = openApiRoute(agendaSponsorChoicesRouteSchema, async (c, data) => {
  const { db, event } = await authorize(c, data.params.eventSlug, false);
  return json(await listAgendaSponsorChoices(db, event.id, data.query));
});
