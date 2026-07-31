import { first, all, run } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import type { AuthMember } from "../types";

/**
 * Fixed price list (USD, smallest currency unit) for self-service Stripe
 * checkout (PRD §1.3 Path B). The PRD does not define tier pricing —
 * consortium tiers (Titanium/Diamond/Platinum/Gold/Silver) are typically
 * negotiated annual contracts, so Path B checkout is scoped to event
 * sponsorship tiers only, where a fixed one-time price is a reasonable
 * placeholder. These figures should be confirmed with finance before
 * launch; see prd.md Phase 1 notes.
 */
export const EVENT_SPONSOR_TIER_PRICES_USD_CENTS: Record<string, number> = {
  Ambassador: 500_000,
  Innovator: 1_000_000,
  Inspirator: 2_000_000,
  Leader: 3_500_000,
};

export function normalizeOrgName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function findOrganizationIdByName(db: DatabaseLike, organizationName: string): Promise<string | null> {
  const row = await first<{ id: string }>(db, `SELECT id FROM organizations WHERE normalized_name = ? LIMIT 1`, [
    normalizeOrgName(organizationName),
  ]);
  return row?.id ?? null;
}

export interface CreateSponsorshipInquiryInput {
  sponsorType: "consortium" | "event";
  organizationId: string | null;
  nonMemberName: string | null;
  nonMemberWebsite: string | null;
  contactName: string;
  contactEmail: string;
  eventId: string | null;
  tier: string;
  notes: string | null;
}

export async function createSponsorshipInquiry(
  db: DatabaseLike,
  input: CreateSponsorshipInquiryInput,
): Promise<{ id: string }> {
  const id = uuid();
  const now = nowIso();

  await db.batch([
    db
      .prepare(
        `INSERT INTO sponsorships
           (id, sponsor_type, organization_id, non_member_name, non_member_website,
            contact_name, contact_email, event_id, tier, notes, pipeline_stage, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new_inquiry', ?, ?)`,
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
        input.notes,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO sponsorship_events (id, sponsorship_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, NULL, 'new_inquiry', NULL, 'Submitted via public inquiry form', ?)`,
      )
      .bind(uuid(), id, now),
  ]);

  return { id };
}

export interface SponsorshipRow {
  id: string;
  sponsor_type: string;
  organization_id: string | null;
  non_member_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  event_id: string | null;
  tier: string | null;
  pipeline_stage: string;
  checkout_session_id: string | null;
}

export async function getSponsorshipByCheckoutSessionId(
  db: DatabaseLike,
  sessionId: string,
): Promise<SponsorshipRow | null> {
  return first<SponsorshipRow>(db, `SELECT * FROM sponsorships WHERE checkout_session_id = ?`, [sessionId]);
}

/**
 * Idempotently creates the sponsorships record for a completed Path B
 * checkout (webhook-driven — see prd.md §1.3: the record is created on
 * successful payment, not at checkout-session-creation time). Safe to call
 * more than once for the same session id (Stripe may retry webhooks).
 */
export async function recordPaidSponsorshipCheckout(
  db: DatabaseLike,
  params: {
    checkoutSessionId: string;
    tier: string;
    contactName: string;
    contactEmail: string;
    organizationName: string | null;
    eventId: string | null;
  },
): Promise<SponsorshipRow> {
  const existing = await getSponsorshipByCheckoutSessionId(db, params.checkoutSessionId);
  if (existing) {
    return existing;
  }

  const organizationId = params.organizationName ? await findOrganizationIdByName(db, params.organizationName) : null;
  const id = uuid();
  const now = nowIso();

  await db.batch([
    db
      .prepare(
        `INSERT INTO sponsorships
           (id, sponsor_type, organization_id, non_member_name, contact_name, contact_email,
            event_id, tier, pipeline_stage, checkout_session_id, created_at, updated_at)
         VALUES (?, 'event', ?, ?, ?, ?, ?, ?, 'payment_pending', ?, ?, ?)`,
      )
      .bind(
        id,
        organizationId,
        organizationId ? null : params.organizationName,
        params.contactName,
        params.contactEmail,
        params.eventId,
        params.tier,
        params.checkoutSessionId,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO sponsorship_events (id, sponsorship_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, 'new_inquiry', 'payment_pending', NULL, 'Stripe checkout completed', ?)`,
      )
      .bind(uuid(), id, now),
  ]);

  return (await getSponsorshipByCheckoutSessionId(db, params.checkoutSessionId)) as SponsorshipRow;
}

// ── Admin sales pipeline (PRD §4.13, Phase 4E) ────────────────────────────

export const SPONSORSHIP_PIPELINE_STAGES = [
  "new_inquiry",
  "contacted",
  "proposal_sent",
  "negotiating",
  "payment_pending",
  "active",
  "lapsed",
] as const;
export type SponsorshipPipelineStage = (typeof SPONSORSHIP_PIPELINE_STAGES)[number];

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
  created_at: string;
  updated_at: string;
}

const ADMIN_SPONSORSHIP_SELECT = `
  SELECT sp.id, sp.sponsor_type, sp.organization_id, o.name AS organization_name,
         sp.non_member_name, sp.non_member_website, sp.non_member_logo_r2_key, sp.contact_name, sp.contact_email,
         sp.event_id, e.name AS event_name, sp.tier, sp.pipeline_stage,
         sp.start_date, sp.renewal_date, sp.assigned_to_user_id,
         COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS assigned_to_name,
         sp.notes, sp.created_at, sp.updated_at
  FROM sponsorships sp
  LEFT JOIN organizations o ON o.id = sp.organization_id
  LEFT JOIN events e ON e.id = sp.event_id
  LEFT JOIN users u ON u.id = sp.assigned_to_user_id
`;

export async function listAdminSponsorships(
  db: DatabaseLike,
  filters: { type?: string; stage?: string; tier?: string; limit: number; offset: number },
): Promise<{ sponsorships: AdminSponsorshipRow[]; total: number }> {
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
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sponsorships = await all<AdminSponsorshipRow>(
    db,
    `${ADMIN_SPONSORSHIP_SELECT} ${where} ORDER BY sp.updated_at DESC LIMIT ? OFFSET ?`,
    [...values, filters.limit, filters.offset],
  );
  const totalRow = await first<{ n: number }>(db, `SELECT COUNT(*) AS n FROM sponsorships sp ${where}`, values);

  return { sponsorships, total: totalRow?.n ?? 0 };
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
 * lapsed" side effects from §4.13:
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

// ── Per-event sponsor attendee-data tier config (§4.13) ───────────────────

export interface EventSponsorTierRow {
  tierName: string;
  hasAttendeeDataAccess: boolean;
}

export async function listEventSponsorTiers(db: DatabaseLike, eventId: string): Promise<EventSponsorTierRow[]> {
  const rows = await all<{ tier_name: string; has_attendee_data_access: number }>(
    db,
    `SELECT tier_name, has_attendee_data_access FROM event_sponsor_attendee_tiers WHERE event_id = ? ORDER BY tier_name ASC`,
    [eventId],
  );
  return rows.map((r) => ({ tierName: r.tier_name, hasAttendeeDataAccess: r.has_attendee_data_access === 1 }));
}

export async function replaceEventSponsorTiers(
  db: DatabaseLike,
  eventId: string,
  tiers: EventSponsorTierRow[],
): Promise<void> {
  const now = nowIso();
  const statements = [db.prepare(`DELETE FROM event_sponsor_attendee_tiers WHERE event_id = ?`).bind(eventId)];
  for (const tier of tiers) {
    statements.push(
      db
        .prepare(
          `INSERT INTO event_sponsor_attendee_tiers (id, event_id, tier_name, has_attendee_data_access, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(uuid(), eventId, tier.tierName, tier.hasAttendeeDataAccess ? 1 : 0, now, now),
    );
  }
  await db.batch(statements);
}

export async function eventSponsorTierHasAttendeeAccess(
  db: DatabaseLike,
  eventId: string,
  tier: string,
): Promise<boolean> {
  const row = await first<{ has_attendee_data_access: number }>(
    db,
    `SELECT has_attendee_data_access FROM event_sponsor_attendee_tiers WHERE event_id = ? AND tier_name = ?`,
    [eventId, tier],
  );
  return row?.has_attendee_data_access === 1;
}

// ── Member self-service (§4.13 "GET /api/v1/me/organization/sponsorship") ─

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

// ── Sponsor portal attendee data (§4.13) ───────────────────────────────────

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
