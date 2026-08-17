/**
 * Admin sales pipeline. Split out of sponsorship.ts.
 */
import { first, all, run } from "../../db/queries";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
import { eventSponsorTierHasAttendeeAccess } from "./event-tiers";
import {
  SPONSORSHIP_PIPELINE_STAGES,
  type SponsorshipPipelineStage,
} from "../../../../assets/shared/schemas/admin-sponsorships";
import type { DatabaseLike } from "../../types";

export { SPONSORSHIP_PIPELINE_STAGES };
export type { SponsorshipPipelineStage };

export interface AdminSponsorshipRow {
  id: string;
  sponsor_type: string;
  organization_id: string | null;
  organization_name: string | null;
  non_member_name: string | null;
  non_member_website: string | null;
  non_member_logo_r2_key: string | null;
  contact_name: string | null;
  contact_email: string | null;
  event_id: string | null;
  event_name: string | null;
  tier: string | null;
  pipeline_stage: string;
  start_date: string | null;
  renewal_date: string | null;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  notes: string | null;
  price_amount_cents: number | null;
  price_currency: string | null;
  created_at: string;
  updated_at: string;
}

const ADMIN_SPONSORSHIP_SELECT = `
  SELECT sp.id, sp.sponsor_type, sp.organization_id, o.name AS organization_name,
         sp.non_member_name, sp.non_member_website, sp.non_member_logo_r2_key, sp.contact_name, sp.contact_email,
         sp.event_id, e.name AS event_name, sp.tier, sp.pipeline_stage,
         sp.start_date, sp.renewal_date, sp.assigned_to_user_id,
         COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS assigned_to_name,
         sp.notes, sp.price_amount_cents, sp.price_currency, sp.created_at, sp.updated_at
  FROM sponsorships sp
  LEFT JOIN organizations o ON o.id = sp.organization_id
  LEFT JOIN events e ON e.id = sp.event_id
  LEFT JOIN users u ON u.id = sp.assigned_to_user_id
`;

export interface AdminSponsorshipsFilters {
  type?: string;
  stage?: string;
  tier?: string;
  /** Company-scoped filters (companyKey decomposed) — used by the detail
   *  panel to fetch one company's sponsorships instead of the full list. */
  organizationId?: string;
  nonMemberName?: string;
  contactName?: string;
  limit: number;
  offset: number;
}

function buildAdminSponsorshipsWhere(filters: AdminSponsorshipsFilters): { where: string; values: unknown[] } {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.type) {
    conditions.push("sp.sponsor_type = ?");
    values.push(filters.type);
  }
  if (filters.stage) {
    conditions.push("sp.pipeline_stage = ?");
    values.push(filters.stage);
  }
  if (filters.tier) {
    conditions.push("sp.tier = ?");
    values.push(filters.tier);
  }
  if (filters.organizationId) {
    conditions.push("sp.organization_id = ?");
    values.push(filters.organizationId);
  }
  if (filters.nonMemberName) {
    conditions.push("sp.organization_id IS NULL AND sp.non_member_name = ?");
    values.push(filters.nonMemberName);
  }
  if (filters.contactName) {
    conditions.push("sp.organization_id IS NULL AND sp.non_member_name IS NULL AND sp.contact_name = ?");
    values.push(filters.contactName);
  }
  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", values };
}

export async function listAdminSponsorships(
  db: DatabaseLike,
  filters: AdminSponsorshipsFilters,
): Promise<{ sponsorships: AdminSponsorshipRow[]; total: number }> {
  const { where, values } = buildAdminSponsorshipsWhere(filters);

  const sponsorships = await all<AdminSponsorshipRow>(
    db,
    `${ADMIN_SPONSORSHIP_SELECT} ${where} ORDER BY sp.updated_at DESC LIMIT ? OFFSET ?`,
    [...values, filters.limit, filters.offset],
  );
  const totalRow = await first<{ n: number }>(db, `SELECT COUNT(*) AS n FROM sponsorships sp ${where}`, values);

  return { sponsorships, total: totalRow?.n ?? 0 };
}

export interface AdminSponsorshipCompanyRow {
  key: string;
  label: string;
  website: string | null;
  sponsorshipCount: number;
  /** Comma-separated distinct pipeline stages across this company's sponsorships. */
  stages: string;
}

/**
 * Groups sponsorships into "companies" — the member organization when one
 * is attached, otherwise the non-member sponsor's name, then the contact
 * name, then a per-row fallback — in D1 instead of fetching every matching
 * sponsorship into the browser to group client-side (PR #1 review). Backs
 * the admin Sponsorships master list; `listAdminSponsorships` above (with
 * `organizationId`/`nonMemberName`/`contactName`) fetches one selected
 * company's sponsorships for the detail panel.
 */
export async function listSponsorshipCompanies(
  db: DatabaseLike,
  filters: { type?: string; stage?: string; tier?: string; limit: number; offset: number },
): Promise<{ companies: AdminSponsorshipCompanyRow[]; total: number }> {
  const { where, values } = buildAdminSponsorshipsWhere(filters);

  const groupedCte = `
    WITH grouped AS (
      SELECT
        CASE
          WHEN sp.organization_id IS NOT NULL THEN 'org:' || sp.organization_id
          WHEN sp.non_member_name IS NOT NULL THEN 'nonmember:' || sp.non_member_name
          WHEN sp.contact_name IS NOT NULL THEN 'contact:' || sp.contact_name
          ELSE 'sponsorship:' || sp.id
        END AS key,
        COALESCE(o.name, sp.non_member_name, sp.contact_name, 'Unspecified sponsor') AS label,
        sp.non_member_website AS website,
        sp.pipeline_stage AS stage
      FROM sponsorships sp
      LEFT JOIN organizations o ON o.id = sp.organization_id
      ${where}
    )
  `;

  const companies = await all<AdminSponsorshipCompanyRow>(
    db,
    `${groupedCte}
     SELECT key, label, MAX(website) AS website, COUNT(*) AS sponsorshipCount,
            GROUP_CONCAT(DISTINCT stage) AS stages
     FROM grouped
     GROUP BY key
     ORDER BY label
     LIMIT ? OFFSET ?`,
    [...values, filters.limit, filters.offset],
  );
  const totalRow = await first<{ n: number }>(
    db,
    `${groupedCte} SELECT COUNT(*) AS n FROM (SELECT key FROM grouped GROUP BY key)`,
    values,
  );

  return { companies, total: totalRow?.n ?? 0 };
}

export async function getAdminSponsorship(db: DatabaseLike, id: string): Promise<AdminSponsorshipRow | null> {
  return first<AdminSponsorshipRow>(db, `${ADMIN_SPONSORSHIP_SELECT} WHERE sp.id = ?`, [id]);
}

export function toApiSponsorship(row: AdminSponsorshipRow) {
  return {
    id: row.id,
    sponsorType: row.sponsor_type,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    nonMemberName: row.non_member_name,
    nonMemberWebsite: row.non_member_website,
    nonMemberLogoUrl: row.non_member_logo_r2_key ? `/api/v1/sponsors/${row.id}/logo` : null,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    eventId: row.event_id,
    eventName: row.event_name,
    tier: row.tier,
    pipelineStage: row.pipeline_stage,
    startDate: row.start_date,
    renewalDate: row.renewal_date,
    assignedToUserId: row.assigned_to_user_id,
    assignedToName: row.assigned_to_name,
    notes: row.notes,
    priceAmountCents: row.price_amount_cents,
    priceCurrency: row.price_currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SponsorshipEventRow {
  id: string;
  from_stage: string | null;
  to_stage: string;
  actor_user_id: string | null;
  actor_name: string | null;
  note: string | null;
  created_at: string;
}

export async function listSponsorshipEvents(db: DatabaseLike, sponsorshipId: string): Promise<SponsorshipEventRow[]> {
  return all<SponsorshipEventRow>(
    db,
    `SELECT se.id, se.from_stage, se.to_stage, se.actor_user_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS actor_name,
            se.note, se.created_at
     FROM sponsorship_events se
     LEFT JOIN users u ON u.id = se.actor_user_id
     WHERE se.sponsorship_id = ?
     ORDER BY se.created_at ASC`,
    [sponsorshipId],
  );
}

export interface CreateAdminSponsorshipInput {
  sponsorType: "consortium" | "event";
  organizationId: string | null;
  nonMemberName: string | null;
  nonMemberWebsite: string | null;
  contactName: string | null;
  contactEmail: string | null;
  eventId: string | null;
  tier: string | null;
  assignedToUserId: string | null;
  renewalDate: string | null;
  notes: string | null;
}

export async function createAdminSponsorship(
  db: DatabaseLike,
  input: CreateAdminSponsorshipInput,
): Promise<{ id: string }> {
  const id = uuid();
  const now = nowIso();

  await db.batch([
    db
      .prepare(
        `INSERT INTO sponsorships
           (id, sponsor_type, organization_id, non_member_name, non_member_website, contact_name, contact_email,
            event_id, tier, pipeline_stage, assigned_to_user_id, renewal_date, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new_inquiry', ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.sponsorType,
        input.organizationId,
        input.nonMemberName,
        input.nonMemberWebsite,
        input.contactName,
        input.contactEmail,
        input.eventId,
        input.tier,
        input.assignedToUserId,
        input.renewalDate,
        input.notes,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO sponsorship_events (id, sponsorship_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, NULL, 'new_inquiry', NULL, 'Created by staff', ?)`,
      )
      .bind(uuid(), id, now),
  ]);

  return { id };
}

export interface UpdateAdminSponsorshipInput {
  tier?: string | null;
  assignedToUserId?: string | null;
  renewalDate?: string | null;
  notes?: string | null;
}

export async function updateAdminSponsorship(
  db: DatabaseLike,
  id: string,
  patch: UpdateAdminSponsorshipInput,
): Promise<AdminSponsorshipRow> {
  const existing = await getAdminSponsorship(db, id);
  if (!existing) {
    throw new AppError(404, "SPONSORSHIP_NOT_FOUND", "Sponsorship not found");
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.tier !== undefined) {
    fields.push("tier = ?");
    values.push(patch.tier);
  }
  if (patch.assignedToUserId !== undefined) {
    fields.push("assigned_to_user_id = ?");
    values.push(patch.assignedToUserId);
  }
  if (patch.renewalDate !== undefined) {
    fields.push("renewal_date = ?");
    values.push(patch.renewalDate);
  }
  if (patch.notes !== undefined) {
    fields.push("notes = ?");
    values.push(patch.notes);
  }

  if (fields.length > 0) {
    fields.push("updated_at = ?");
    values.push(nowIso());
    await run(db, `UPDATE sponsorships SET ${fields.join(", ")} WHERE id = ?`, [...values, id]);
  }

  return (await getAdminSponsorship(db, id)) as AdminSponsorshipRow;
}

export interface AdvanceSponsorshipStageResult {
  sponsorship: AdminSponsorshipRow;
  becameActive: boolean;
  becameLapsed: boolean;
  qualifiesForAttendeeDataAccess: boolean;
}

/**
 * Advances (or otherwise changes) a sponsorship's pipeline stage, recording
 * the transition in sponsorship_events and applying the "On active"/"On
 * lapsed" side effects from:
 *  - consortium: writes/clears organizations.sponsor_tier + sponsor_start_date
 *  - event: no D1 side effect beyond the stage itself — attendee-data
 *    eligibility (event_sponsor_attendee_tiers) is checked live on every
 *    sponsor-portal request (see _lib/auth/sponsor-portal.ts), not cached
 *    as a grant row, because sponsor contacts have no `users` row for a
 *    permission_grants row to attach to. `qualifiesForAttendeeDataAccess`
 *    tells the caller (route) whether to send the sponsor-portal-access
 *    email on this transition.
 */
export async function advanceSponsorshipStage(
  db: DatabaseLike,
  params: { id: string; toStage: string; actorUserId: string | null; note: string | null },
): Promise<AdvanceSponsorshipStageResult> {
  if (!SPONSORSHIP_PIPELINE_STAGES.includes(params.toStage as SponsorshipPipelineStage)) {
    throw new AppError(400, "INVALID_STAGE", `Unknown pipeline stage: ${params.toStage}`);
  }

  const existing = await getAdminSponsorship(db, params.id);
  if (!existing) {
    throw new AppError(404, "SPONSORSHIP_NOT_FOUND", "Sponsorship not found");
  }

  const fromStage = existing.pipeline_stage;
  const now = nowIso();
  const becameActive = params.toStage === "active" && fromStage !== "active";
  const becameLapsed = params.toStage === "lapsed" && fromStage !== "lapsed";

  const statements = [
    db
      .prepare(
        `UPDATE sponsorships SET pipeline_stage = ?, start_date = COALESCE(start_date, CASE WHEN ? = 'active' THEN ? ELSE start_date END), updated_at = ? WHERE id = ?`,
      )
      .bind(params.toStage, params.toStage, now, now, params.id),
    db
      .prepare(
        `INSERT INTO sponsorship_events (id, sponsorship_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(uuid(), params.id, fromStage, params.toStage, params.actorUserId, params.note, now),
  ];

  if (existing.sponsor_type === "consortium" && existing.organization_id) {
    if (becameActive) {
      statements.push(
        db
          .prepare(`UPDATE organizations SET sponsor_tier = ?, sponsor_start_date = ? WHERE id = ?`)
          .bind(existing.tier, existing.start_date ?? now, existing.organization_id),
      );
    } else if (becameLapsed) {
      statements.push(
        db
          .prepare(`UPDATE organizations SET sponsor_tier = NULL, sponsor_start_date = NULL WHERE id = ?`)
          .bind(existing.organization_id),
      );
    }
  }

  await db.batch(statements);

  let qualifiesForAttendeeDataAccess = false;
  if (becameActive && existing.sponsor_type === "event" && existing.event_id && existing.tier) {
    qualifiesForAttendeeDataAccess = await eventSponsorTierHasAttendeeAccess(db, existing.event_id, existing.tier);
  }

  return {
    sponsorship: (await getAdminSponsorship(db, params.id)) as AdminSponsorshipRow,
    becameActive,
    becameLapsed,
    qualifiesForAttendeeDataAccess,
  };
}
