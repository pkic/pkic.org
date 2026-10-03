import { offlineEligibilityRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-event-offline-eligibility";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { offlineEligibility } from "../../../../_lib/services/event-participation/offline-eligibility";
import { requireEventPermission } from "./authorization";
export const OfflineEligibilityGet = openApiRoute(offlineEligibilityRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:scan");
  const response = json(await offlineEligibility(db, event.id, actor.id, data.query));
  response.headers.set("Cache-Control", "no-store");
  return response;
});
