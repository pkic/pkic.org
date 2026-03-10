import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { all } from "../../../../../_lib/db/queries";
import type { PagesContext } from "../../../../../_lib/types";

/**
 * GET /api/v1/admin/events/:eventSlug/promoters
 *
 * Returns a promoter leaderboard for an event, combining:
 *  - Per-inviter invite statistics (invites sent, accepted, declined, conversion rate)
 *  - Per-user referral code statistics (link clicks, registrations driven)
 *
 * Sorted by overall effectiveness: conversions desc, then acceptances desc, then invites sent desc.
 */
export async function onRequestGet(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);

  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);

  // ── 1. Per-inviter invite stats ──────────────────────────────────────────
  const inviterStats = await all<{
    inviter_user_id: string;
    inviter_email: string | null;
    inviter_first_name: string | null;
    inviter_last_name: string | null;
    invites_sent: number;
    invites_accepted: number;
    invites_declined: number;
    invites_expired: number;
    last_invite_at: string | null;
  }>(
    context.env.DB,
    `SELECT
       i.inviter_user_id,
       u.email             AS inviter_email,
       u.first_name        AS inviter_first_name,
       u.last_name         AS inviter_last_name,
       COUNT(*)            AS invites_sent,
       COUNT(CASE WHEN i.status = 'accepted' THEN 1 END) AS invites_accepted,
       COUNT(CASE WHEN i.status = 'declined' THEN 1 END) AS invites_declined,
       COUNT(CASE WHEN i.status = 'expired'  THEN 1 END) AS invites_expired,
       MAX(i.created_at)   AS last_invite_at
     FROM invites i
     LEFT JOIN users u ON u.id = i.inviter_user_id
     WHERE i.event_id = ?
       AND i.invite_type = 'attendee'
       AND i.inviter_user_id IS NOT NULL
     GROUP BY i.inviter_user_id
     ORDER BY invites_accepted DESC, invites_sent DESC`,
    [event.id],
  );

  // ── 2. Per-user referral code stats ──────────────────────────────────────
  //
  // Each referral code has BOTH a created_by_user_id AND an owner (via
  // owner_type + owner_id).  For owner_type = 'registration' the owner IS the
  // registrant, so we fall back to the registration's user_id when
  // created_by_user_id is not set.  This makes the leaderboard robust to edge
  // cases where the column was not populated (e.g. admin-created codes).
  const referralStats = await all<{
    effective_user_id: string;
    referrer_email: string | null;
    referrer_first_name: string | null;
    referrer_last_name: string | null;
    codes_issued: number;
    total_clicks: number;
    total_conversions: number;
  }>(
    context.env.DB,
    `SELECT
       COALESCE(rc.created_by_user_id, reg.user_id) AS effective_user_id,
       COALESCE(u1.email,      u2.email)      AS referrer_email,
       COALESCE(u1.first_name, u2.first_name) AS referrer_first_name,
       COALESCE(u1.last_name,  u2.last_name)  AS referrer_last_name,
       COUNT(DISTINCT rc.code) AS codes_issued,
       SUM(rc.clicks)          AS total_clicks,
       SUM(rc.conversions)     AS total_conversions
     FROM referral_codes rc
     -- direct creator
     LEFT JOIN users u1 ON u1.id = rc.created_by_user_id
     -- owner via registration (owner_type = 'registration')
     LEFT JOIN registrations reg
       ON rc.owner_type = 'registration' AND reg.id = rc.owner_id
     LEFT JOIN users u2 ON u2.id = reg.user_id
     WHERE rc.event_id = ?
       AND COALESCE(rc.created_by_user_id, reg.user_id) IS NOT NULL
     GROUP BY COALESCE(rc.created_by_user_id, reg.user_id)
     ORDER BY total_conversions DESC, total_clicks DESC`,
    [event.id],
  );

  // ── 3. Per-user referral code details (individual codes) ─────────────────
  //
  // Resolve the owner user the same way: COALESCE(created_by_user_id, reg.user_id)
  // so even codes without an explicit creator are attributed correctly.
  const referralCodes = await all<{
    code: string;
    owner_type: string;
    owner_id: string;
    effective_user_id: string | null;
    owner_email: string | null;
    owner_first_name: string | null;
    owner_last_name: string | null;
    channel_hint: string | null;
    clicks: number;
    conversions: number;
    created_at: string;
  }>(
    context.env.DB,
    `SELECT
       rc.code,
       rc.owner_type,
       rc.owner_id,
       COALESCE(rc.created_by_user_id, reg.user_id) AS effective_user_id,
       COALESCE(u1.email,      u2.email)      AS owner_email,
       COALESCE(u1.first_name, u2.first_name) AS owner_first_name,
       COALESCE(u1.last_name,  u2.last_name)  AS owner_last_name,
       rc.channel_hint,
       rc.clicks,
       rc.conversions,
       rc.created_at
     FROM referral_codes rc
     LEFT JOIN users u1 ON u1.id = rc.created_by_user_id
     LEFT JOIN registrations reg
       ON rc.owner_type = 'registration' AND reg.id = rc.owner_id
     LEFT JOIN users u2 ON u2.id = reg.user_id
     WHERE rc.event_id = ?
     ORDER BY rc.conversions DESC, rc.clicks DESC`,
    [event.id],
  );

  // ── 4. Recent referral click timeline (last 30 days, by day) ─────────────
  const clickTimeline = await all<{ date: string; clicks: number }>(
    context.env.DB,
    `SELECT
       date(created_at) AS date,
       COUNT(*)         AS clicks
     FROM referral_clicks
     WHERE event_id = ?
       AND created_at >= date('now', '-30 days')
     GROUP BY date(created_at)
     ORDER BY date ASC`,
    [event.id],
  );

  // ── 5. Merge invite+referral data into a unified promoter list ────────────
  type PromoterEntry = {
    user_id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    // invite metrics
    invites_sent: number;
    invites_accepted: number;
    invites_declined: number;
    invites_expired: number;
    invite_conversion_rate: number | null; // 0-100 pct
    last_invite_at: string | null;
    // referral metrics
    referral_codes_issued: number;
    referral_clicks: number;
    referral_conversions: number;
    // combined score (higher = more impactful)
    impact_score: number;
  };

  const promoterMap = new Map<string, PromoterEntry>();

  for (const row of inviterStats) {
    promoterMap.set(row.inviter_user_id, {
      user_id: row.inviter_user_id,
      email: row.inviter_email,
      first_name: row.inviter_first_name,
      last_name: row.inviter_last_name,
      invites_sent: row.invites_sent,
      invites_accepted: row.invites_accepted,
      invites_declined: row.invites_declined,
      invites_expired: row.invites_expired,
      invite_conversion_rate:
        row.invites_sent > 0
          ? Math.round((row.invites_accepted / row.invites_sent) * 100)
          : null,
      last_invite_at: row.last_invite_at,
      referral_codes_issued: 0,
      referral_clicks: 0,
      referral_conversions: 0,
      impact_score: 0,
    });
  }

  for (const row of referralStats) {
    const existing = promoterMap.get(row.effective_user_id);
    if (existing) {
      existing.referral_codes_issued = row.codes_issued;
      existing.referral_clicks       = row.total_clicks;
      existing.referral_conversions  = row.total_conversions;
    } else {
      promoterMap.set(row.effective_user_id, {
        user_id: row.effective_user_id,
        email: row.referrer_email,
        first_name: row.referrer_first_name,
        last_name: row.referrer_last_name,
        invites_sent: 0,
        invites_accepted: 0,
        invites_declined: 0,
        invites_expired: 0,
        invite_conversion_rate: null,
        last_invite_at: null,
        referral_codes_issued: row.codes_issued,
        referral_clicks: row.total_clicks,
        referral_conversions: row.total_conversions,
        impact_score: 0,
      });
    }
  }

  // Compute impact score: invites accepted worth 4 pts, referral conversions 4 pts,
  // referral clicks 1 pt, invites sent 0.5 pt (activity signal).
  const promoters: PromoterEntry[] = Array.from(promoterMap.values()).map((p) => ({
    ...p,
    impact_score: Math.round(
      p.invites_accepted      * 4 +
      p.referral_conversions  * 4 +
      p.referral_clicks       * 1 +
      p.invites_sent          * 0.5,
    ),
  }));

  promoters.sort((a, b) => b.impact_score - a.impact_score || b.invites_accepted - a.invites_accepted);

  return json({
    eventSlug: event.slug,
    promoters,
    referralCodes,
    clickTimeline,
  });
}

export async function onRequest(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  if (context.request.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(context);
}
