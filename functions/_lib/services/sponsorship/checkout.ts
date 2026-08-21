/**
 * Public sponsorship inquiry submission and Stripe checkout (Path B)
 * payment recording. Split out of sponsorship.ts (PR #1 review).
 */
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import { prepareQueueEmailStatement } from "../../email/outbox";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import type { DatabaseLike } from "../../types";

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
  organizationName: string;
  nonMemberName: string | null;
  nonMemberWebsite: string | null;
  contactName: string;
  contactEmail: string;
  eventId: string | null;
  tier: string;
  notes: string | null;
  eventName: string;
  brochureUrl: string;
  notificationEmail: string;
  adminUrl: string;
}

export async function createSponsorshipInquiry(
  db: DatabaseLike,
  input: CreateSponsorshipInquiryInput,
): Promise<{ id: string; outboxIds: string[] }> {
  const id = uuid();
  const now = nowIso();
  const brochureEmail = prepareQueueEmailStatement(
    db,
    {
      templateKey: "sponsorship-brochure",
      recipientEmail: input.contactEmail,
      messageType: "transactional",
      subject: "PKI Consortium sponsorship information",
      data: {
        contactName: input.contactName,
        eventName: input.eventName,
        brochureUrl: input.brochureUrl,
      },
    },
    now,
  );
  const staffEmail = prepareQueueEmailStatement(
    db,
    {
      templateKey: "sponsorship-new-inquiry",
      recipientEmail: input.notificationEmail,
      messageType: "transactional",
      subject: `New sponsorship inquiry: ${input.contactName} (${input.organizationName})`,
      data: {
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        organizationName: input.organizationName,
        sponsorType: input.sponsorType,
        tier: input.tier,
        notes: input.notes ?? "",
        adminUrl: input.adminUrl,
      },
    },
    now,
  );

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
    brochureEmail.statement,
    staffEmail.statement,
    prepareAuditLog(
      db,
      "public",
      null,
      "sponsorship_inquiry_submitted",
      "sponsorship",
      id,
      {
        sponsorType: input.sponsorType,
        tier: input.tier,
        organizationName: input.organizationName,
      },
      now,
    ),
  ]);

  return { id, outboxIds: [brochureEmail.id, staffEmail.id] };
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
  stripe_event_id: string | null;
  price_amount_cents: number | null;
  price_currency: string | null;
}

const SPONSORSHIP_SELECT = `SELECT
  id, sponsor_type, organization_id, non_member_name, contact_name,
  contact_email, event_id, tier, pipeline_stage, checkout_session_id,
  stripe_event_id, price_amount_cents, price_currency
FROM sponsorships`;

export async function getSponsorshipByCheckoutSessionId(
  db: DatabaseLike,
  sessionId: string,
): Promise<SponsorshipRow | null> {
  return first<SponsorshipRow>(db, `${SPONSORSHIP_SELECT} WHERE checkout_session_id = ?`, [sessionId]);
}

interface PaidCheckoutContext {
  event_name: string;
  organization_id: string | null;
  tier_exists: number;
}

async function resolvePaidCheckoutContext(
  db: DatabaseLike,
  params: Pick<RecordPaidSponsorshipCheckoutParams, "eventId" | "eventSlug" | "tier" | "organizationName">,
): Promise<PaidCheckoutContext> {
  const context = await first<PaidCheckoutContext>(
    db,
    `SELECT
       e.name AS event_name,
       (SELECT o.id FROM organizations o WHERE o.normalized_name = ? LIMIT 1) AS organization_id,
       EXISTS(
         SELECT 1 FROM sponsorship_tier_catalog c
         WHERE c.sponsor_type = 'event' AND c.tier = ?
       ) AS tier_exists
     FROM events e
     WHERE e.id = ? AND e.slug = ?
     LIMIT 1`,
    [normalizeOrgName(params.organizationName ?? ""), params.tier, params.eventId, params.eventSlug],
  );
  if (!context) {
    throw new AppError(422, "INVALID_CHECKOUT_CONTEXT", "The paid checkout references an unknown event");
  }
  if (context.tier_exists !== 1) {
    throw new AppError(422, "INVALID_CHECKOUT_CONTEXT", "The paid checkout references an unknown sponsorship tier");
  }
  return context;
}

export interface RecordPaidSponsorshipCheckoutParams {
  stripeEventId: string;
  checkoutSessionId: string;
  tier: string;
  contactName: string;
  contactEmail: string;
  organizationName: string | null;
  eventId: string;
  eventSlug: string;
  priceAmountCents: number;
  priceCurrency: string;
  brochureUrl: string;
  notificationEmail: string;
  adminUrl: string;
}

export interface RecordPaidSponsorshipCheckoutResult {
  sponsorship: SponsorshipRow;
  created: boolean;
  outboxIds: string[];
}

async function getExistingPaidCheckout(
  db: DatabaseLike,
  stripeEventId: string,
  checkoutSessionId: string,
): Promise<SponsorshipRow | null> {
  const existing = await first<SponsorshipRow>(
    db,
    `${SPONSORSHIP_SELECT} WHERE checkout_session_id = ? OR stripe_event_id = ? LIMIT 1`,
    [checkoutSessionId, stripeEventId],
  );
  if (existing && existing.checkout_session_id !== checkoutSessionId) {
    throw new AppError(409, "STRIPE_EVENT_CONFLICT", "Stripe event was already recorded for another checkout");
  }
  return existing;
}

/**
 * Idempotently creates the sponsorships record for a completed Path B
 * checkout (webhook-driven — the record is created on
 * successful payment, not at checkout-session-creation time). Safe to call
 * more than once for the same session id (Stripe may retry webhooks).
 */
export async function recordPaidSponsorshipCheckout(
  db: DatabaseLike,
  params: RecordPaidSponsorshipCheckoutParams,
): Promise<RecordPaidSponsorshipCheckoutResult> {
  const existing = await getExistingPaidCheckout(db, params.stripeEventId, params.checkoutSessionId);
  if (existing) {
    return { sponsorship: existing, created: false, outboxIds: [] };
  }

  const context = await resolvePaidCheckoutContext(db, params);
  const id = uuid();
  const now = nowIso();
  const brochureEmail = prepareQueueEmailStatement(
    db,
    {
      templateKey: "sponsorship-brochure",
      recipientEmail: params.contactEmail,
      messageType: "transactional",
      subject: "PKI Consortium sponsorship information",
      data: {
        contactName: params.contactName,
        eventName: context.event_name,
        brochureUrl: params.brochureUrl,
      },
    },
    now,
  );
  const staffEmail = prepareQueueEmailStatement(
    db,
    {
      templateKey: "sponsorship-new-inquiry",
      recipientEmail: params.notificationEmail,
      messageType: "transactional",
      subject: `New sponsorship inquiry: ${params.contactName} (${params.organizationName ?? "n/a"})`,
      data: {
        contactName: params.contactName,
        contactEmail: params.contactEmail,
        organizationName: params.organizationName ?? "",
        sponsorType: "event",
        tier: params.tier,
        notes: "Paid via self-service Stripe checkout",
        adminUrl: params.adminUrl,
      },
    },
    now,
  );

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO sponsorships
             (id, sponsor_type, organization_id, non_member_name, contact_name, contact_email,
              event_id, tier, pipeline_stage, checkout_session_id, stripe_event_id,
              price_amount_cents, price_currency, created_at, updated_at)
           VALUES (?, 'event', ?, ?, ?, ?, ?, ?, 'payment_pending', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          context.organization_id,
          context.organization_id ? null : params.organizationName,
          params.contactName,
          params.contactEmail,
          params.eventId,
          params.tier,
          params.checkoutSessionId,
          params.stripeEventId,
          params.priceAmountCents,
          params.priceCurrency,
          now,
          now,
        ),
      db
        .prepare(
          `INSERT INTO sponsorship_events (id, sponsorship_id, from_stage, to_stage, actor_user_id, note, created_at)
           VALUES (?, ?, NULL, 'payment_pending', NULL, 'Stripe checkout completed', ?)`,
        )
        .bind(uuid(), id, now),
      brochureEmail.statement,
      staffEmail.statement,
      prepareAuditLog(
        db,
        "system",
        null,
        "sponsorship_checkout_paid",
        "sponsorship",
        id,
        {
          stripeEventId: params.stripeEventId,
          checkoutSessionId: params.checkoutSessionId,
          tier: params.tier,
          priceAmountCents: params.priceAmountCents,
          priceCurrency: params.priceCurrency,
        },
        now,
      ),
    ]);
  } catch (error) {
    const raced = await getExistingPaidCheckout(db, params.stripeEventId, params.checkoutSessionId);
    if (raced) return { sponsorship: raced, created: false, outboxIds: [] };
    throw error;
  }

  const sponsorship = await getSponsorshipByCheckoutSessionId(db, params.checkoutSessionId);
  if (!sponsorship) {
    throw new Error("Paid sponsorship checkout committed without a readable sponsorship row");
  }
  return { sponsorship, created: true, outboxIds: [brochureEmail.id, staffEmail.id] };
}
