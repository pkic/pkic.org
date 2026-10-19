import { eventPublicationRequestsRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-site-publication-requests";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { listSitePublicationRequests } from "../../../../../_lib/services/site-publication-requests";
import { authorize } from "./index";

export const AgendaPublicationRequestsGet = openApiRoute(eventPublicationRequestsRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, false);
  return json(
    await listSitePublicationRequests(db, actor, { resourceType: "event_agenda", resourceId: event.id }, data.query),
  );
});
