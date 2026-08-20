/**
 * Member self-service sponsorship status (
 * "GET /api/v1/me/organization/sponsorship") and sponsor-portal attendee
 * data. Split out of sponsorship.ts.
 */
import { first, all } from "../../db/queries";
import { queryPage } from "../../db/pagination";
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

const SPONSOR_PORTAL_ATTENDEES_FROM = `
  FROM registrations r
  JOIN users u ON u.id = r.user_id
  JOIN consent_acceptances ca ON ca.registration_id = r.id AND ca.term_key = 'sponsor-data-sharing'
  WHERE r.event_id = ? AND r.status = 'registered'
`;

function toAttendeeRow(r: {
  registration_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  organization_name: string | null;
  job_title: string | null;
  attendance_type: string | null;
}): SponsorPortalAttendeeRow {
  return {
    registrationId: r.registration_id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    organizationName: r.organization_name,
    jobTitle: r.job_title,
    attendanceType: r.attendance_type,
  };
}

/**
 * Unbounded — for the CSV export endpoint (P6M-P2-11's finding is about the
 * paginated JSON list endpoint specifically; a CSV export inherently needs
 * every consenting row in one response, so it keeps the full unbounded
 * fetch here rather than composing the pagination contract).
 */
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
     ${SPONSOR_PORTAL_ATTENDEES_FROM}
     ORDER BY u.last_name ASC, u.first_name ASC`,
    [eventId],
  );

  return rows.map(toAttendeeRow);
}

/** Bounded LIMIT/OFFSET + real COUNT(*) — used by the JSON list endpoint (P6M-P2-11). */
export async function listSponsorPortalAttendeesPage(
  db: DatabaseLike,
  eventId: string,
  params: { limit: number; offset: number },
): Promise<{ attendees: SponsorPortalAttendeeRow[]; total: number }> {
  const { rows, total } = await queryPage<{
    registration_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    organization_name: string | null;
    job_title: string | null;
    attendance_type: string | null;
  }>(
    db,
    {
      sql: `SELECT r.id AS registration_id, u.first_name, u.last_name, u.email,
              u.organization_name, u.job_title, r.attendance_type
       ${SPONSOR_PORTAL_ATTENDEES_FROM}
       ORDER BY u.last_name ASC, u.first_name ASC
       LIMIT ? OFFSET ?`,
      bindings: [eventId, params.limit, params.offset],
    },
    { sql: `SELECT COUNT(*) AS total ${SPONSOR_PORTAL_ATTENDEES_FROM}`, bindings: [eventId] },
  );

  return { attendees: rows.map(toAttendeeRow), total };
}
