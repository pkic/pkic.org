import { eventDetailResponseSchema } from "../../../../../assets/shared/schemas/event-management";
import { eventDetailRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-events";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { prepareOptionalRequestViewer } from "../../../../_lib/auth/optional-request-viewer";
import { readEventDetailPage } from "../../../../_lib/services/events/detail-page";
import { readGroupEventSettingsPage } from "../../../../_lib/services/events/group-settings-detail";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const EventDetailGet = openApiRoute(eventDetailRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const auth = await prepareOptionalRequestViewer(db, c.req.raw, c.env);
  const event = data.query.groupId
    ? await readGroupEventSettingsPage(db, auth, data.query.groupId, data.params.eventSlug)
    : await readEventDetailPage(db, data.params.eventSlug, auth);
  return json(eventDetailResponseSchema.parse({ event }));
});
