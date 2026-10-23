import {
  eventScanCreateRouteSchema,
  scannerTargetsRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-event-scanning";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { recordScannerUploadRequest } from "../../../../_lib/services/event-participation/scanner-request";
import { requireEventScannerPermission } from "./authorization";
import { scannerTargets } from "../../../../_lib/services/event-participation/reporting";
export const ScannerTargetsGet = openApiRoute(scannerTargetsRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventScannerPermission(c, data.params.eventSlug, [
    "agenda:check",
    "agenda:admit",
    "agenda:attendance_record",
  ]);
  return json(await scannerTargets(db, event.id, data.query));
});

export const EventScanCreate = openApiRoute(eventScanCreateRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  return json(await recordScannerUploadRequest(requestDb(c), c.req.raw, c.env, data.params.eventSlug, data.body));
});
