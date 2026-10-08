import { agendaPreviewRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-event-agenda-preview";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { jsonPrivate } from "../../../../../_lib/http";
import { previewAgenda } from "../../../../../_lib/services/event-agenda/preview";
import { authorize } from "./index";

export const AgendaPreviewGet = openApiRoute(agendaPreviewRouteSchema, async (c, data) => {
  const { db, event } = await authorize(c, data.params.eventSlug, false);
  return jsonPrivate(await previewAgenda(db, event.id, event.slug, data.query.revision));
});
