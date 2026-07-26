import { first } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import type { DatabaseLike } from "../types";

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
