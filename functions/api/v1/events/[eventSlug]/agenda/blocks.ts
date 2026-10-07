import { agendaBlocksGetRouteSchema } from "../../../../../../assets/shared/schemas/event-agenda-block-list";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listAgendaBlocks } from "../../../../../_lib/services/event-agenda/block-list";
import { authorize } from "./index";

export const AgendaBlocksGet = openApiRoute(agendaBlocksGetRouteSchema, async (c, data) => {
  const { db, event } = await authorize(c, data.params.eventSlug, false);
  return json(await listAgendaBlocks(db, event.id, data.query));
});
