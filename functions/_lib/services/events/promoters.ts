import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import type {
  EventPromoter,
  EventPromotersListResponse,
  EventReferralCode,
} from "../../../../assets/shared/schemas/admin-event-promoters";
import { batchFirst, batchRows } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";

interface SummaryRow {
  active_promoters: number;
  promoters_with_registrations: number;
  total_invites_sent: number;
  total_invites_accepted: number;
  total_referral_clicks: number;
  total_referral_conversions: number;
}

const PROMOTER_READ_MODEL = `
  WITH invite_stats AS (
    SELECT inviter_user_id AS user_id,
           COUNT(*) AS invites_sent,
           COUNT(CASE WHEN status = 'accepted' THEN 1 END) AS invites_accepted,
           COUNT(CASE WHEN status = 'declined' THEN 1 END) AS invites_declined,
           COUNT(CASE WHEN status = 'expired' THEN 1 END) AS invites_expired,
           MAX(created_at) AS last_invite_at
      FROM invites
     WHERE event_id = ? AND invite_type = 'attendee' AND inviter_user_id IS NOT NULL
     GROUP BY inviter_user_id
  ), referral_stats AS (
    SELECT COALESCE(rc.created_by_user_id, reg.user_id) AS user_id,
           COUNT(DISTINCT rc.code) AS referral_codes_issued,
           COALESCE(SUM(rc.clicks), 0) AS referral_clicks,
           COALESCE(SUM(rc.conversions), 0) AS referral_conversions
      FROM referral_codes rc
      LEFT JOIN registrations reg ON rc.owner_type = 'registration' AND reg.id = rc.owner_id
     WHERE rc.event_id = ? AND COALESCE(rc.created_by_user_id, reg.user_id) IS NOT NULL
     GROUP BY COALESCE(rc.created_by_user_id, reg.user_id)
  ), promoter_users AS (
    SELECT user_id FROM invite_stats
    UNION
    SELECT user_id FROM referral_stats WHERE referral_clicks > 0
  ), promoter_rows AS (
    SELECT pu.user_id,
           u.email,
           u.first_name,
           u.last_name,
           u.organization_name AS organization,
           u.job_title,
           CASE WHEN u.headshot_r2_key IS NOT NULL THEN '/api/v1/' || u.headshot_r2_key ELSE NULL END AS headshot_url,
           COALESCE(i.invites_sent, 0) AS invites_sent,
           COALESCE(i.invites_accepted, 0) AS invites_accepted,
           COALESCE(i.invites_declined, 0) AS invites_declined,
           COALESCE(i.invites_expired, 0) AS invites_expired,
           CASE WHEN COALESCE(i.invites_sent, 0) > 0
             THEN ROUND(i.invites_accepted * 100.0 / i.invites_sent)
             ELSE NULL END AS invite_conversion_rate,
           i.last_invite_at,
           COALESCE(r.referral_codes_issued, 0) AS referral_codes_issued,
           COALESCE(r.referral_clicks, 0) AS referral_clicks,
           COALESCE(r.referral_conversions, 0) AS referral_conversions,
           ROUND(COALESCE(i.invites_accepted, 0) * 4
             + COALESCE(r.referral_conversions, 0) * 4
             + COALESCE(r.referral_clicks, 0)
             + COALESCE(i.invites_sent, 0) * 0.5) AS impact_score
      FROM promoter_users pu
      LEFT JOIN users u ON u.id = pu.user_id
      LEFT JOIN invite_stats i ON i.user_id = pu.user_id
      LEFT JOIN referral_stats r ON r.user_id = pu.user_id
  )`;

const REFERRAL_CODE_SELECT = `
  SELECT rc.code,
         rc.owner_type,
         rc.owner_id,
         COALESCE(rc.created_by_user_id, reg.user_id) AS effective_user_id,
         u.email AS owner_email,
         u.first_name AS owner_first_name,
         u.last_name AS owner_last_name,
         rc.channel_hint,
         rc.clicks,
         rc.conversions,
         rc.created_at
    FROM referral_codes rc
    LEFT JOIN registrations reg ON rc.owner_type = 'registration' AND reg.id = rc.owner_id
    LEFT JOIN users u ON u.id = COALESCE(rc.created_by_user_id, reg.user_id)
   WHERE rc.event_id = ?`;

export async function listEventPromotionActivity(
  db: DatabaseLike,
  event: { id: string; slug: string },
  params: { view: "promoters" | "codes"; limit: number; offset: number; q?: string; sort?: string },
): Promise<EventPromotersListResponse> {
  const promoterSearch = params.q
    ? buildD1TextSearchFilter(params.q, ["email", "first_name", "last_name", "organization"])
    : null;
  const codeSearch = params.q
    ? buildD1TextSearchFilter(params.q, ["rc.code", "u.email", "u.first_name", "u.last_name"])
    : null;
  const promoterOrder = resolveMappedOrderBy(
    params.sort,
    { impact: "impact_score", accepted: "invites_accepted", invitations: "invites_sent", clicks: "referral_clicks" },
    "impact_score DESC",
    "user_id ASC",
  );
  const codeOrder = resolveMappedOrderBy(
    params.sort,
    { clicks: "rc.clicks", conversions: "rc.conversions", createdAt: "rc.created_at", code: "rc.code" },
    "rc.conversions DESC, rc.clicks DESC",
    "rc.code ASC",
  );

  const pageStatement =
    params.view === "promoters"
      ? db
          .prepare(
            `${PROMOTER_READ_MODEL} SELECT * FROM promoter_rows WHERE 1 = 1 ${promoterSearch ? `AND ${promoterSearch.sql}` : ""} ${promoterOrder} LIMIT ? OFFSET ?`,
          )
          .bind(event.id, event.id, ...(promoterSearch?.bindings ?? []), params.limit, params.offset)
      : db
          .prepare(`${REFERRAL_CODE_SELECT} ${codeSearch ? `AND ${codeSearch.sql}` : ""} ${codeOrder} LIMIT ? OFFSET ?`)
          .bind(event.id, ...(codeSearch?.bindings ?? []), params.limit, params.offset);
  const countStatement =
    params.view === "promoters"
      ? db
          .prepare(
            `${PROMOTER_READ_MODEL} SELECT COUNT(*) AS total FROM promoter_rows WHERE 1 = 1 ${promoterSearch ? `AND ${promoterSearch.sql}` : ""}`,
          )
          .bind(event.id, event.id, ...(promoterSearch?.bindings ?? []))
      : db
          .prepare(
            `SELECT COUNT(*) AS total FROM (${REFERRAL_CODE_SELECT} ${codeSearch ? `AND ${codeSearch.sql}` : ""})`,
          )
          .bind(event.id, ...(codeSearch?.bindings ?? []));

  const [pageResult, countResult, summaryResult, codeCountResult] = await db.batch([
    pageStatement,
    countStatement,
    db
      .prepare(
        `${PROMOTER_READ_MODEL}
       SELECT COUNT(*) AS active_promoters,
              COUNT(CASE WHEN invites_accepted > 0 OR referral_conversions > 0 THEN 1 END) AS promoters_with_registrations,
              COALESCE(SUM(invites_sent), 0) AS total_invites_sent,
              COALESCE(SUM(invites_accepted), 0) AS total_invites_accepted,
              COALESCE(SUM(referral_clicks), 0) AS total_referral_clicks,
              COALESCE(SUM(referral_conversions), 0) AS total_referral_conversions
         FROM promoter_rows`,
      )
      .bind(event.id, event.id),
    db.prepare("SELECT COUNT(*) AS total FROM referral_codes WHERE event_id = ?").bind(event.id),
  ]);

  const promoters = params.view === "promoters" ? batchRows<EventPromoter>(pageResult) : [];
  const referralCodes = params.view === "codes" ? batchRows<EventReferralCode>(pageResult) : [];
  const total = batchFirst<{ total: number }>(countResult)?.total ?? 0;
  const summary = batchFirst<SummaryRow>(summaryResult);
  return {
    eventSlug: event.slug,
    view: params.view,
    promoters,
    referralCodes,
    page: buildPageInfo(params.limit, params.offset, total, promoters.length + referralCodes.length),
    summary: {
      activePromoters: summary?.active_promoters ?? 0,
      promotersWithRegistrations: summary?.promoters_with_registrations ?? 0,
      totalInvitesSent: summary?.total_invites_sent ?? 0,
      totalInvitesAccepted: summary?.total_invites_accepted ?? 0,
      totalReferralClicks: summary?.total_referral_clicks ?? 0,
      totalReferralConversions: summary?.total_referral_conversions ?? 0,
      referralCodeCount: batchFirst<{ total: number }>(codeCountResult)?.total ?? 0,
    },
  };
}
