import { offlineEligibilityRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-event-offline-eligibility";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { enrolledOfflineEligibility } from "../../../../_lib/services/event-participation/scanner-preparation";
import { guardPermissionDatabase } from "../../../../_lib/auth/permissions";
import { AppError } from "../../../../_lib/errors";
import { requireEventScannerPermission } from "./authorization";
export const OfflineEligibilityGet = openApiRoute(offlineEligibilityRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { actor, db, event, context, permission } = await requireEventScannerPermission(c, data.params.eventSlug, [
    "agenda:check",
    "agenda:admit",
    "agenda:attendance_record",
  ]);
  const guarded = guardPermissionDatabase(
    db,
    actor,
    [{ permission, context }],
    () => new AppError(403, "SCAN_PERMISSION_CHANGED", "Your scanning permission changed. Sign in again."),
  );
  const response = json(await enrolledOfflineEligibility(guarded, event.id, actor.id, data.query));
  response.headers.set("Cache-Control", "no-store");
  return response;
});
