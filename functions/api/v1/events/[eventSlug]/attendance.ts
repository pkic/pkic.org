import {
  eventAttendanceRouteSchema,
  eventSponsorLeadRouteSchema,
  sessionAttendancePeopleRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-event-attendance";
import { guardPermissionDatabase } from "../../../../_lib/auth/permissions";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { attendanceReport, sessionAttendancePeople } from "../../../../_lib/services/event-participation/reporting";
import { captureSponsorLead } from "../../../../_lib/services/event-participation/sponsor-leads";
import { requireSponsorLeadPermission } from "./sponsor-authorization";
import { requireEventPermission } from "./authorization";
export const EventAttendanceGet = openApiRoute(eventAttendanceRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:attendance_read");
  return json(await attendanceReport(db, event.id, data.query));
});
export const SessionAttendancePeopleGet = openApiRoute(
  sessionAttendancePeopleRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const { db, event } = await requireEventPermission(c, data.params.eventSlug, "agenda:attendance_read");
    return json(await sessionAttendancePeople(db, event.id, data.params.occurrenceId, data.query));
  },
);
export const EventSponsorLeadCreate = openApiRoute(eventSponsorLeadRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event, actor, context } = await requireSponsorLeadPermission(
    c,
    data.params.eventSlug,
    data.params.sponsorId,
  );
  const guarded = guardPermissionDatabase(
    db,
    actor,
    [{ permission: "agenda:leads_capture", context }],
    () => new AppError(403, "LEAD_PERMISSION_CHANGED", "Your lead scanning permission changed."),
  );
  return json(await captureSponsorLead(guarded, event.id, data.params.sponsorId, actor.id, data.body));
});
