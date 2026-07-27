/**
 * GET /api/v1/sponsor-portal/events/:eventId/attendees/export — CSV export
 * (PRD §4.13). Same eligibility gate as ./index.ts.
 */
import { listSponsorPortalAttendees } from "../../../../../../_lib/services/sponsorship";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import { requireEligibleSponsorPortalSession } from "./index";
import type { AdminContext } from "../../../../../../_lib/db/context";

function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCsvRow(fields: unknown[]): string {
  return fields.map(escapeCsvField).join(",");
}

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const { db, session } = await requireEligibleSponsorPortalSession(c);
  const attendees = await listSponsorPortalAttendees(db, session.eventId);

  await writeAuditLog(
    db,
    "sponsor",
    session.sponsorshipId,
    "sponsor_portal_attendee_export",
    "sponsorship",
    session.sponsorshipId,
    {
      recordCount: attendees.length,
    },
  );

  const headers = ["First name", "Last name", "Email", "Organization", "Job title", "Attendance type"];
  const lines = [
    toCsvRow(headers),
    ...attendees.map((a) =>
      toCsvRow([a.firstName, a.lastName, a.email, a.organizationName, a.jobTitle, a.attendanceType]),
    ),
  ];

  return new Response(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="attendees-${session.eventId}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
