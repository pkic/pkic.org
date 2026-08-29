/**
 * Sponsor access as a live capacity of the canonical user identity.
 *
 * The email capability proves control of the current sponsorship contact
 * mailbox. It never creates a second session type: redemption establishes the
 * normal user session, and every sponsor request re-derives capacity from D1.
 */
import type { SponsorCapacity } from "../../../assets/shared/schemas/sponsor-access";
import { all, first } from "../db/queries";
import type { AuthorizationEvidence } from "../db/authorization-guard";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { normalizeEmail } from "../validation";
import {
  assertEmailAuthCapabilityEmail,
  queueEmailAuthCapability,
  verifyEmailAuthCapabilityToken,
  type VerifiedEmailAuthCapability,
} from "./email-auth-capabilities";

interface SponsorshipCapacityRow {
  id: string;
  event_id: string;
  event_slug: string;
  event_name: string | null;
  tier: string | null;
  contact_email: string;
}

const ACTIVE_EVENT_SPONSORSHIP_SQL = `
  s.sponsor_type = 'event'
  AND s.pipeline_stage = 'active'
  AND s.event_id IS NOT NULL
  AND s.contact_email IS NOT NULL
`;

const USER_SPONSOR_EMAILS_CTE = `
  user_sponsor_emails(normalized_email) AS (
    SELECT u.normalized_email
      FROM users u
     WHERE u.id = ? AND u.active = 1
    UNION
    SELECT ue.normalized_email
      FROM user_emails ue
      JOIN users u ON u.id = ue.user_id
     WHERE ue.user_id = ? AND ue.verified_at IS NOT NULL AND u.active = 1
  )
`;

function toSponsorCapacity(row: SponsorshipCapacityRow): SponsorCapacity {
  return {
    sponsorId: row.id,
    eventId: row.event_id,
    eventSlug: row.event_slug,
    eventName: row.event_name,
    tier: row.tier ?? "",
    contactEmail: row.contact_email,
  };
}

async function findActiveEventSponsorship(
  db: DatabaseLike,
  sponsorshipId: string,
): Promise<SponsorshipCapacityRow | null> {
  return first<SponsorshipCapacityRow>(
    db,
    `SELECT s.id, s.event_id, e.slug AS event_slug, e.name AS event_name, s.tier, s.contact_email
       FROM sponsorships s
       JOIN events e ON e.id = s.event_id
      WHERE s.id = ? AND ${ACTIVE_EVENT_SPONSORSHIP_SQL}`,
    [sponsorshipId],
  );
}

/** All sponsor relationships currently reachable through a verified user email. */
export async function findActiveSponsorCapacitiesByUserId(
  db: DatabaseLike,
  userId: string,
): Promise<SponsorCapacity[]> {
  const rows = await all<SponsorshipCapacityRow>(
    db,
    `WITH ${USER_SPONSOR_EMAILS_CTE}
     SELECT s.id, s.event_id, e.slug AS event_slug, e.name AS event_name, s.tier, s.contact_email
       FROM user_sponsor_emails se
       JOIN sponsorships s ON lower(trim(s.contact_email)) = se.normalized_email
       JOIN events e ON e.id = s.event_id
      WHERE ${ACTIVE_EVENT_SPONSORSHIP_SQL}
      ORDER BY lower(COALESCE(e.name, e.slug)), lower(COALESCE(s.tier, '')), s.id`,
    [userId, userId],
  );
  return rows.map(toSponsorCapacity);
}

/** Re-check the exact sponsor/event capacity requested by a user session. */
export async function findActiveSponsorCapacityForUser(
  db: DatabaseLike,
  userId: string,
  sponsorshipId: string,
  eventIdOrSlug: string,
): Promise<SponsorCapacity | null> {
  const row = await first<SponsorshipCapacityRow>(
    db,
    `WITH ${USER_SPONSOR_EMAILS_CTE}
     SELECT s.id, s.event_id, e.slug AS event_slug, e.name AS event_name, s.tier, s.contact_email
       FROM user_sponsor_emails se
       JOIN sponsorships s ON lower(trim(s.contact_email)) = se.normalized_email
       JOIN events e ON e.id = s.event_id
      WHERE ${ACTIVE_EVENT_SPONSORSHIP_SQL}
        AND s.id = ?
        AND (e.id = ? OR e.slug = ?)
      LIMIT 1`,
    [userId, userId, sponsorshipId, eventIdOrSlug, eventIdOrSlug],
  );
  return row ? toSponsorCapacity(row) : null;
}

/** Same-batch evidence for disclosing attendee data to one live sponsor capacity. */
export function sponsorAttendeeAuthorizationEvidence(
  userId: string,
  sponsorshipId: string,
  eventIdOrSlug: string,
): AuthorizationEvidence {
  return {
    sql: `WITH ${USER_SPONSOR_EMAILS_CTE}
          SELECT 1
            FROM user_sponsor_emails se
            JOIN sponsorships s ON lower(trim(s.contact_email)) = se.normalized_email
            JOIN events e ON e.id = s.event_id
            JOIN event_sponsor_attendee_tiers t
              ON t.event_id = s.event_id
             AND t.tier_name = s.tier
             AND t.has_attendee_data_access = 1
           WHERE ${ACTIVE_EVENT_SPONSORSHIP_SQL}
             AND s.id = ?
             AND (e.id = ? OR e.slug = ?)
           LIMIT 1`,
    bindings: [userId, userId, sponsorshipId, eventIdOrSlug, eventIdOrSlug],
  };
}

/** Same-batch evidence for redeeming a sponsor-mailbox capability. */
export function sponsorSignInAuthorizationEvidence(
  sponsorshipId: string,
  normalizedContactEmail: string,
): AuthorizationEvidence {
  return {
    sql: `SELECT 1
            FROM sponsorships s
            JOIN events e ON e.id = s.event_id
           WHERE s.id = ?
             AND ${ACTIVE_EVENT_SPONSORSHIP_SQL}
             AND lower(trim(s.contact_email)) = ?`,
    bindings: [sponsorshipId, normalizedContactEmail],
  };
}

/** Same-batch evidence that an ordinary user sign-in retains sponsor access. */
export function sponsorUserSignInAuthorizationEvidence(
  userId: string,
  normalizedPrimaryEmail: string,
): AuthorizationEvidence {
  return {
    sql: `SELECT 1
            FROM users u
           WHERE u.id = ? AND u.active = 1 AND u.normalized_email = ?
             AND EXISTS (
               SELECT 1
                 FROM sponsorships s
                 JOIN events e ON e.id = s.event_id
                WHERE ${ACTIVE_EVENT_SPONSORSHIP_SQL}
                  AND (
                    lower(trim(s.contact_email)) = u.normalized_email
                    OR EXISTS (
                      SELECT 1
                        FROM user_emails ue
                       WHERE ue.user_id = u.id
                         AND ue.verified_at IS NOT NULL
                         AND ue.normalized_email = lower(trim(s.contact_email))
                    )
                  )
             )`,
    bindings: [userId, normalizedPrimaryEmail],
  };
}

export async function queueSponsorSignInCapabilityForEmail(
  db: DatabaseLike,
  payload: {
    email: string;
    eventId: string;
    ipHash?: string | null;
    userAgentHash?: string | null;
    ttlMinutes: number;
    signingSecret: string;
  },
): Promise<{ queuedToken: string | null; sponsorship: SponsorCapacity | null }> {
  const email = normalizeEmail(payload.email);
  const row = await first<SponsorshipCapacityRow>(
    db,
    `SELECT s.id, s.event_id, e.slug AS event_slug, e.name AS event_name, s.tier, s.contact_email
       FROM sponsorships s
       JOIN events e ON e.id = s.event_id
      WHERE ${ACTIVE_EVENT_SPONSORSHIP_SQL}
        AND (e.id = ? OR e.slug = ?)
        AND lower(trim(s.contact_email)) = ?`,
    [payload.eventId, payload.eventId, email],
  );
  if (!row) return { queuedToken: null, sponsorship: null };
  const capability = await queueSponsorSignInCapability(row.id, row.contact_email, payload);
  return { queuedToken: capability.queuedToken, sponsorship: toSponsorCapacity(row) };
}

/** Queue marker materialized into a signed capability only by the outbox. */
export async function queueSponsorSignInCapability(
  sponsorshipId: string,
  contactEmail: string,
  payload: {
    signingSecret: string;
    ipHash?: string | null;
    userAgentHash?: string | null;
    ttlMinutes: number;
  },
): Promise<{ queuedToken: string }> {
  const capability = await queueEmailAuthCapability({
    signingSecret: payload.signingSecret,
    purpose: "sponsor_sign_in",
    subjectId: sponsorshipId,
    email: contactEmail,
    ttlSeconds: payload.ttlMinutes * 60,
    ipHash: payload.ipHash,
    userAgentHash: payload.userAgentHash,
  });
  return { queuedToken: capability.queuedToken };
}

export async function verifySponsorSignInCapability(
  db: DatabaseLike,
  payload: {
    token: string;
    signingSecret: string;
    ipHash?: string | null;
    userAgentHash?: string | null;
  },
): Promise<{ capability: VerifiedEmailAuthCapability; sponsorship: SponsorCapacity }> {
  const capability = await verifyEmailAuthCapabilityToken({
    signingSecret: payload.signingSecret,
    purpose: "sponsor_sign_in",
    token: payload.token,
    ipHash: payload.ipHash,
    userAgentHash: payload.userAgentHash,
  });
  const row = await findActiveEventSponsorship(db, capability.subjectId);
  if (!row) throw new AppError(403, "AUTH_FORBIDDEN", "This sponsorship is no longer active");
  await assertEmailAuthCapabilityEmail({
    signingSecret: payload.signingSecret,
    capability,
    currentEmail: row.contact_email,
  });
  return { capability, sponsorship: toSponsorCapacity(row) };
}
