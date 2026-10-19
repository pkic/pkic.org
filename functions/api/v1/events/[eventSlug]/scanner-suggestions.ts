import { scannerSuggestionsRouteSchema } from "../../../../../assets/shared/schemas/event-scanner-suggestions";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { jsonNoStore } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { scannerSuggestions } from "../../../../_lib/services/event-participation/scanner-suggestions";
import { requireEventScannerPermission } from "./authorization";
export const ScannerSuggestionsGet = openApiRoute(scannerSuggestionsRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, actor } = await requireEventScannerPermission(c, data.params.eventSlug, [
    "agenda:check",
    "agenda:admit",
    "agenda:attendance_record",
  ]);
  return jsonNoStore(await scannerSuggestions(db, event.id, actor.id));
});
