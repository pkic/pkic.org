/**
 * Member self-service sponsorship status (
 * "GET /api/v1/me/organization/sponsorship") and sponsor-portal attendee
 * data. Split out of sponsorship.ts.
 */
import { first, all } from "../../db/queries";
import type { AuthMember, DatabaseLike } from "../../types";

export async function getMyOrganizationSponsorship(
  db: DatabaseLike,
  member: AuthMember,
): Promise<{ tier: string | null; startDate: string | null }> {
  if (!member.organizationId) {
    return { tier: null, startDate: null };
  }
  const row = await first<{ sponsor_tier: string | null; sponsor_start_date: string | null }>(
    db,
    `SELECT sponsor_tier, sponsor_start_date FROM organizations WHERE id = ?`,
    [member.organizationId],
  );
  return { tier: row?.sponsor_tier ?? null, startDate: row?.sponsor_start_date ?? null };
}

export interface SponsorPortalAttendeeRow {
  registrationId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  organizationName: string | null;
  jobTitle: string | null;
  attendanceType: string | null;
}

export async function listSponsorPortalAttendees(
  db: DatabaseLike,
  eventId: string,
): Promise<SponsorPortalAttendeeRow[]> {
  const rows = await all<{
    registration_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    organization_name: string | null;
    job_title: string | null;
    attendance_type: string | null;
  }>(
    db,
    `SELECT r.id AS registration_id, u.first_name, u.last_name, u.email,
            u.organization_name, u.job_title, r.attendance_type
     FROM registrations r
     JOIN users u ON u.id = r.user_id
     JOIN consent_acceptances ca ON ca.registration_id = r.id AND ca.term_key = 'sponsor-data-sharing'
     WHERE r.event_id = ? AND r.status = 'registered'
     ORDER BY u.last_name ASC, u.first_name ASC`,
    [eventId],
  );

  return rows.map((r) => ({
    registrationId: r.registration_id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    organizationName: r.organization_name,
    jobTitle: r.job_title,
    attendanceType: r.attendance_type,
  }));
}
