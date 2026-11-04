import {
  scannerAttendeesRouteSchema,
  scannerAttendeeBadgeRouteSchema,
} from "../../../../../assets/shared/schemas/event-scanner-lookup";
import { markResponseSensitive, requestDb } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  readScannerAttendees,
  readScannerAttendeeBadge,
} from "../../../../_lib/services/event-participation/scanner-attendee-lookup";

export const ScannerAttendeesGet = openApiRoute(scannerAttendeesRouteSchema, async (c, data) => {
  markResponseSensitive(c);
  return json(await readScannerAttendees(requestDb(c), c.req.raw, c.env, data.params.eventSlug, data.query));
});

export const ScannerAttendeeBadgeGet = openApiRoute(scannerAttendeeBadgeRouteSchema, async (c, data) => {
  markResponseSensitive(c);
  return json(
    await readScannerAttendeeBadge(requestDb(c), c.req.raw, c.env, data.params.eventSlug, data.params.userId),
  );
});
