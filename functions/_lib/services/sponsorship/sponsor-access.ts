/**
 * Organization-member sponsorship status and sponsor attendee
 * data. Split out of sponsorship.ts.
 */
import { first } from "../../db/queries";
import {
  batchRows,
  buildOffsetPageStatements,
  decodeOffsetPageResults,
  queryPage,
  type OffsetPageQuery,
} from "../../db/pagination";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { AuthMember, DatabaseLike, StatementLike } from "../../types";
import type { SponsorCapacity } from "../../../../assets/shared/schemas/sponsor-access";
import { findActiveSponsorCapacityForUser, sponsorAttendeeAuthorizationEvidence } from "../../auth/sponsor-capacity";
import { eventSponsorTierHasAttendeeAccess } from "./event-tiers";
import { writeAuditLog } from "../audit";
import type { SponsorAttendeesListQuery } from "../../../../assets/shared/schemas/sponsor-access";

export async function requireSponsorAttendeeAccess(
  db: DatabaseLike,
  userId: string,
  sponsorshipId: string,
  eventId: string,
): Promise<SponsorCapacity> {
  const capacity = await findActiveSponsorCapacityForUser(db, userId, sponsorshipId, eventId);
  if (!capacity) {
    throw new AppError(403, "SPONSOR_RESOURCE_MISMATCH", "This identity does not represent that sponsor and event");
  }
  if (!(await eventSponsorTierHasAttendeeAccess(db, capacity.eventId, capacity.tier))) {
    throw new AppError(403, "SPONSOR_TIER_INELIGIBLE", "This sponsorship's tier does not have attendee data access");
  }
  return capacity;
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

export interface SponsorAttendeeRow {
  registrationId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  organizationName: string | null;
  jobTitle: string | null;
  attendanceType: string | null;
}

const SPONSOR_ATTENDEES_FROM = `
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
}): SponsorAttendeeRow {
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

type SponsorAttendeeDatabaseRow = {
  registration_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  organization_name: string | null;
  job_title: string | null;
  attendance_type: string | null;
};

function prepareSponsorAttendeeExport(db: DatabaseLike, eventId: string, maxRows: number): StatementLike {
  return db
    .prepare(
      `SELECT r.id AS registration_id, u.first_name, u.last_name, u.email,
              u.organization_name, u.job_title, r.attendance_type
       ${SPONSOR_ATTENDEES_FROM}
       ORDER BY u.last_name ASC, u.first_name ASC
       LIMIT ?`,
    )
    .bind(eventId, maxRows + 1);
}

function assertExportWithinLimit(rows: SponsorAttendeeDatabaseRow[], maxRows: number): SponsorAttendeeRow[] {
  if (rows.length > maxRows) {
    throw new AppError(413, "CSV_EXPORT_ROW_LIMIT_EXCEEDED", `CSV export is limited to ${maxRows} records`);
  }
  return rows.map(toAttendeeRow);
}

/** Bounded export read; callers fail instead of silently returning a partial CSV. */
export async function listSponsorAttendeesForExport(
  db: DatabaseLike,
  eventId: string,
  maxRows: number,
): Promise<SponsorAttendeeRow[]> {
  const rows = await prepareSponsorAttendeeExport(db, eventId, maxRows).all<SponsorAttendeeDatabaseRow>();
  return assertExportWithinLimit(rows.results, maxRows);
}

function buildSponsorAttendeesPageQuery(eventId: string, params: SponsorAttendeesListQuery): OffsetPageQuery {
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
  return {
    sql: `SELECT r.id AS registration_id, u.first_name, u.last_name, u.email,
              u.organization_name, u.job_title, r.attendance_type
       ${SPONSOR_ATTENDEES_FROM}
       ${searchSql}
       `,
    bindings,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  };
}

/** Bounded LIMIT/OFFSET + real COUNT(*) — used by the JSON list endpoint (P6M-P2-11). */
export async function listSponsorAttendeesPage(
  db: DatabaseLike,
  eventId: string,
  params: SponsorAttendeesListQuery,
): Promise<{ attendees: SponsorAttendeeRow[]; total: number }> {
  const { rows, total } = await queryPage<SponsorAttendeeDatabaseRow>(
    db,
    buildSponsorAttendeesPageQuery(eventId, params),
  );

  return { attendees: rows.map(toAttendeeRow), total };
}

export async function listSponsorAttendeesPageWithAudit(
  db: DatabaseLike,
  actorUserId: string,
  capacity: SponsorCapacity,
  params: SponsorAttendeesListQuery,
): Promise<{ attendees: SponsorAttendeeRow[]; total: number }> {
  let result: { attendees: SponsorAttendeeRow[]; total: number };
  try {
    const [, pageResult, countResult] = await db.batch([
      prepareAuthorizationGuard(
        db,
        sponsorAttendeeAuthorizationEvidence(actorUserId, capacity.sponsorId, capacity.eventId),
      ),
      ...buildOffsetPageStatements(db, buildSponsorAttendeesPageQuery(capacity.eventId, params)),
    ]);
    const page = decodeOffsetPageResults<SponsorAttendeeDatabaseRow>(pageResult, countResult);
    result = { attendees: page.rows.map(toAttendeeRow), total: page.total };
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(403, "SPONSOR_ACCESS_CHANGED", "Sponsor attendee access is no longer available");
    }
    throw error;
  }
  await writeAuditLog(db, "user", actorUserId, "sponsor_attendee_list_viewed", "sponsorship", capacity.sponsorId, {
    recordCount: result.attendees.length,
  });
  return result;
}

export async function listSponsorAttendeesForExportWithAudit(
  db: DatabaseLike,
  actorUserId: string,
  capacity: SponsorCapacity,
  maxRows: number,
): Promise<SponsorAttendeeRow[]> {
  let attendees: SponsorAttendeeRow[];
  try {
    const [, exportResult] = await db.batch([
      prepareAuthorizationGuard(
        db,
        sponsorAttendeeAuthorizationEvidence(actorUserId, capacity.sponsorId, capacity.eventId),
      ),
      prepareSponsorAttendeeExport(db, capacity.eventId, maxRows),
    ]);
    attendees = assertExportWithinLimit(batchRows<SponsorAttendeeDatabaseRow>(exportResult), maxRows);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(403, "SPONSOR_ACCESS_CHANGED", "Sponsor attendee access is no longer available");
    }
    throw error;
  }
  await writeAuditLog(db, "user", actorUserId, "sponsor_attendee_export", "sponsorship", capacity.sponsorId, {
    recordCount: attendees.length,
  });
  return attendees;
}
