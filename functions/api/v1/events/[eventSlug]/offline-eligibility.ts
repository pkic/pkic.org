import { offlineEligibilityRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-event-offline-eligibility";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { readEnrolledOfflineEligibilityRequest } from "../../../../_lib/services/event-participation/scanner-preparation";
export const OfflineEligibilityGet = openApiRoute(offlineEligibilityRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const response = json(
    await readEnrolledOfflineEligibilityRequest(requestDb(c), c.req.raw, c.env, data.params.eventSlug, data.query),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
});
