/**
 * Organization-member sponsorship status and sponsor-portal attendee
 * data. Split out of sponsorship.ts.
 */
import { first, all } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { AuthMember, DatabaseLike } from "../../types";
import type { SponsorPortalSession } from "../../auth/sponsor-portal";
import { eventSponsorTierHasAttendeeAccess } from "./event-tiers";
import { writeAuditLog } from "../audit";
import type { SponsorPortalAttendeesListQuery } from "../../../../assets/shared/schemas/sponsor-portal";

export async function requireSponsorPortalAttendeeAccess(
  db: DatabaseLike,
  session: SponsorPortalSession,
  eventId: string,
): Promise<void> {
  if (eventId !== session.eventId) {
    throw new AppError(403, "SPONSOR_PORTAL_EVENT_MISMATCH", "This session is not scoped to that event");
  }
  if (!(await eventSponsorTierHasAttendeeAccess(db, session.eventId, session.tier))) {
    throw new AppError(
      403,
      "SPONSOR_PORTAL_TIER_INELIGIBLE",
      "This sponsorship's tier does not have attendee data access",
    );
  }
}

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
  WHERE r.event_id = ? AND r.status = 'registered'
    AND EXISTS (
      SELECT 1 FROM consent_acceptances ca
       WHERE ca.registration_id = r.id AND ca.term_key = 'sponsor-data-sharing'
    )
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

/** Bounded export read; callers fail instead of silently returning a partial CSV. */
export async function listSponsorPortalAttendeesForExport(
  db: DatabaseLike,
  eventId: string,
  maxRows: number,
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
     ORDER BY u.last_name ASC, u.first_name ASC
     LIMIT ?`,
    [eventId, maxRows + 1],
  );

  if (rows.length > maxRows) {
    throw new AppError(413, "CSV_EXPORT_ROW_LIMIT_EXCEEDED", `CSV export is limited to ${maxRows} records`);
  }

  return rows.map(toAttendeeRow);
}

/** Bounded LIMIT/OFFSET + real COUNT(*) — used by the JSON list endpoint (P6M-P2-11). */
export async function listSponsorPortalAttendeesPage(
  db: DatabaseLike,
  eventId: string,
  params: SponsorPortalAttendeesListQuery,
): Promise<{ attendees: SponsorPortalAttendeeRow[]; total: number }> {
  const search = params.q
    ? buildD1TextSearchFilter(params.q, [
        "u.first_name",
        "u.last_name",
        "u.email",
        "u.organization_name",
        "u.job_title",
        "r.attendance_type",
      ])
    : null;
  const searchSql = search ? `AND ${search.sql}` : "";
  const bindings = [eventId, ...(search?.bindings ?? [])];
  const orderBy = resolveMappedOrderBy(
    params.sort,
    {
      name: "LOWER(COALESCE(u.last_name, '') || ' ' || COALESCE(u.first_name, ''))",
      email: "u.email COLLATE NOCASE",
      organizationName: "u.organization_name COLLATE NOCASE",
      attendanceType: "r.attendance_type",
    },
    "u.last_name ASC, u.first_name ASC",
    "r.id ASC",
  );
  const { rows, total } = await queryPage<{
    registration_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    organization_name: string | null;
    job_title: string | null;
    attendance_type: string | null;
  }>(db, {
    sql: `SELECT r.id AS registration_id, u.first_name, u.last_name, u.email,
              u.organization_name, u.job_title, r.attendance_type
       ${SPONSOR_PORTAL_ATTENDEES_FROM}
       ${searchSql}
       `,
    bindings,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });

  return { attendees: rows.map(toAttendeeRow), total };
}

export async function listSponsorPortalAttendeesPageWithAudit(
  db: DatabaseLike,
  session: SponsorPortalSession,
  params: SponsorPortalAttendeesListQuery,
): Promise<{ attendees: SponsorPortalAttendeeRow[]; total: number }> {
  const result = await listSponsorPortalAttendeesPage(db, session.eventId, params);
  await writeAuditLog(
    db,
    "sponsor",
    session.sponsorshipId,
    "sponsor_portal_attendee_list_viewed",
    "sponsorship",
    session.sponsorshipId,
    { recordCount: result.attendees.length },
  );
  return result;
}

export async function listSponsorPortalAttendeesForExportWithAudit(
  db: DatabaseLike,
  session: SponsorPortalSession,
  maxRows: number,
): Promise<SponsorPortalAttendeeRow[]> {
  const attendees = await listSponsorPortalAttendeesForExport(db, session.eventId, maxRows);
  await writeAuditLog(
    db,
    "sponsor",
    session.sponsorshipId,
    "sponsor_portal_attendee_export",
    "sponsorship",
    session.sponsorshipId,
    { recordCount: attendees.length },
  );
  return attendees;
}
