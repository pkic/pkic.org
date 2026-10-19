import { agendaBreaksCreateRouteSchema } from "../../../../../../assets/shared/schemas/event-agenda-breaks";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { createAgendaBreaks } from "../../../../../_lib/services/event-agenda/breaks";
import { authorize } from "./index";

export const AgendaBreaksPost = openApiRoute(agendaBreaksCreateRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(await createAgendaBreaks(db, event.id, event.slug, data.body, actor.id));
});
