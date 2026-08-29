import { resolveUserSessionFromRequest } from "../../../../../../_lib/auth/user-session";
import { getCsvExportLimits } from "../../../../../../_lib/config";
import { csvResponse, encodeBoundedCsv } from "../../../../../../_lib/csv";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  listSponsorAttendeesForExportWithAudit,
  listSponsorAttendeesPageWithAudit,
  requireSponsorAttendeeAccess,
} from "../../../../../../_lib/services/sponsorship";
import { buildPageInfo } from "../../../../../../../assets/shared/schemas/pagination";
import {
  sponsorAttendeesListResponseSchema,
  sponsorAttendeesListRouteSchema,
} from "../../../../../../../assets/shared/schemas/sponsor-access";

export const SponsorAttendeesList = openApiRoute(sponsorAttendeesListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const session = await resolveUserSessionFromRequest(db, c.req.raw, c.env);
  const capacity = await requireSponsorAttendeeAccess(db, session.identity.id, data.params.id, data.params.eventId);

  if (data.query.format === "csv") {
    const limits = getCsvExportLimits(c.env);
    const attendees = await listSponsorAttendeesForExportWithAudit(db, session.identity.id, capacity, limits.maxRows);
    const csv = encodeBoundedCsv(
      [
        ["First name", "Last name", "Email", "Organization", "Job title", "Attendance type"],
        ...attendees.map((attendee) => [
          attendee.firstName,
          attendee.lastName,
          attendee.email,
          attendee.organizationName,
          attendee.jobTitle,
          attendee.attendanceType,
        ]),
      ],
      limits.maxBytes,
    );
    return csvResponse(csv, `attendees-${capacity.eventSlug}.csv`);
  }

  const { attendees, total } = await listSponsorAttendeesPageWithAudit(db, session.identity.id, capacity, data.query);
  return json(
    sponsorAttendeesListResponseSchema.parse({
      attendees,
      page: buildPageInfo(data.query.limit, data.query.offset, total, attendees.length),
    }),
  );
});
