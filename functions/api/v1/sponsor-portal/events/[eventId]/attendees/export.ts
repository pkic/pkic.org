/**
 * GET /api/v1/sponsor-portal/events/:eventId/attendees/export — CSV export.
 * Same eligibility gate as ./index.ts.
 */
import { getCsvExportLimits } from "../../../../../../_lib/config";
import { csvResponse, encodeBoundedCsv } from "../../../../../../_lib/csv";
import { requireSponsorPortalFromRequest } from "../../../../../../_lib/auth/sponsor-portal";
import {
  listSponsorPortalAttendeesForExportWithAudit,
  requireSponsorPortalAttendeeAccess,
} from "../../../../../../_lib/services/sponsorship";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const session = await requireSponsorPortalFromRequest(db, c.req.raw, c.env);
  await requireSponsorPortalAttendeeAccess(db, session, c.req.param("eventId"));
  const limits = getCsvExportLimits(c.env);
  const attendees = await listSponsorPortalAttendeesForExportWithAudit(db, session, limits.maxRows);
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

  return csvResponse(csv, `attendees-${session.eventId}.csv`);
}
