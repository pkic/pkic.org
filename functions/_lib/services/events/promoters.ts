import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import {
  EVENT_PROMOTER_SORT_COLUMNS,
  EVENT_REFERRAL_CODE_SORT_COLUMNS,
  type EventPromoter,
  type EventPromotersListQuery,
  type EventPromotersListResponse,
  type EventReferralCode,
} from "../../../../assets/shared/schemas/event-promoters";
import { batchFirst, buildOffsetPageStatements, decodeOffsetPageResults } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";

// Keep schema-facing keys and SQL mappings type-coupled: adding a key to a
// view's API tuple requires adding its trusted SQL expression here.
const PROMOTER_SORT_EXPRESSIONS = {
  impact: "impact_score",
  accepted: "invites_accepted",
  invitations: "invites_sent",
  clicks: "referral_clicks",
} satisfies Record<(typeof EVENT_PROMOTER_SORT_COLUMNS)[number], string>;

const REFERRAL_CODE_SORT_EXPRESSIONS = {
  clicks: "rc.clicks",
  conversions: "rc.conversions",
  createdAt: "rc.created_at",
  code: "rc.code",
} satisfies Record<(typeof EVENT_REFERRAL_CODE_SORT_COLUMNS)[number], string>;

interface SummaryRow {
  active_promoters: number;
  promoters_with_registrations: number;
  total_invites_sent: number;
  total_invites_accepted: number;
  total_referral_clicks: number;
  total_referral_conversions: number;
}

interface EventPromoterRow {
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  organization: string | null;
  job_title: string | null;
  headshot_url: string | null;
  invites_sent: number;
  invites_accepted: number;
  invites_declined: number;
  invites_expired: number;
  invite_conversion_rate: number | null;
  last_invite_at: string | null;
  referral_codes_issued: number;
  referral_clicks: number;
  referral_conversions: number;
  impact_score: number;
}

interface EventReferralCodeRow {
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
}

const PROMOTER_READ_MODEL = `
  WITH invite_stats AS (
    SELECT inviter_user_id AS user_id,
           COUNT(*) AS invites_sent,
           COUNT(CASE WHEN status = 'accepted' THEN 1 END) AS invites_accepted,
           COUNT(CASE WHEN status = 'declined' THEN 1 END) AS invites_declined,
           COUNT(CASE WHEN status = 'expired' THEN 1 END) AS invites_expired,
           MAX(strftime('%Y-%m-%dT%H:%M:%fZ', created_at)) AS last_invite_at
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
         strftime('%Y-%m-%dT%H:%M:%fZ', rc.created_at) AS created_at
    FROM referral_codes rc
    LEFT JOIN registrations reg ON rc.owner_type = 'registration' AND reg.id = rc.owner_id
    LEFT JOIN users u ON u.id = COALESCE(rc.created_by_user_id, reg.user_id)
   WHERE rc.event_id = ?`;

const PROMOTER_SELECT_COLUMNS = `user_id, email, first_name, last_name, organization, job_title, headshot_url,
  invites_sent, invites_accepted, invites_declined, invites_expired, invite_conversion_rate, last_invite_at,
  referral_codes_issued, referral_clicks, referral_conversions, impact_score`;

export async function listEventPromotionActivity(
  db: DatabaseLike,
  event: { id: string; slug: string },
  params: EventPromotersListQuery,
): Promise<EventPromotersListResponse> {
  const promoterSearch = params.q
    ? buildD1TextSearchFilter(params.q, ["email", "first_name", "last_name", "organization"])
    : null;
  const codeSearch = params.q
    ? buildD1TextSearchFilter(params.q, ["rc.code", "u.email", "u.first_name", "u.last_name"])
    : null;
  const promoterOrder = resolveMappedOrderBy(
    params.sort,
    PROMOTER_SORT_EXPRESSIONS,
    "impact_score DESC",
    "user_id ASC",
  );
  const codeOrder = resolveMappedOrderBy(
    params.sort,
    REFERRAL_CODE_SORT_EXPRESSIONS,
    "rc.conversions DESC, rc.clicks DESC",
    "rc.code ASC",
  );

  const pageQuery =
    params.view === "promoters"
      ? {
          sql: `${PROMOTER_READ_MODEL} SELECT ${PROMOTER_SELECT_COLUMNS} FROM promoter_rows
                WHERE 1 = 1 ${promoterSearch ? `AND ${promoterSearch.sql}` : ""}`,
          bindings: [event.id, event.id, ...(promoterSearch?.bindings ?? [])],
          orderBy: promoterOrder,
          limit: params.limit,
          offset: params.offset,
        }
      : {
          sql: `${REFERRAL_CODE_SELECT} ${codeSearch ? `AND ${codeSearch.sql}` : ""}`,
          bindings: [event.id, ...(codeSearch?.bindings ?? [])],
          orderBy: codeOrder,
          limit: params.limit,
          offset: params.offset,
        };
  const [pageStatement, countStatement] = buildOffsetPageStatements(db, pageQuery);

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

  const { rows: pageRows, total } = decodeOffsetPageResults<EventPromoterRow | EventReferralCodeRow>(
    pageResult,
    countResult,
  );
  const promoters: EventPromoter[] =
    params.view === "promoters"
      ? (pageRows as EventPromoterRow[]).map((row) => ({
          userId: row.user_id,
          email: row.email,
          firstName: row.first_name,
          lastName: row.last_name,
          organization: row.organization,
          jobTitle: row.job_title,
          headshotUrl: row.headshot_url,
          invitesSent: row.invites_sent,
          invitesAccepted: row.invites_accepted,
          invitesDeclined: row.invites_declined,
          invitesExpired: row.invites_expired,
          inviteConversionRate: row.invite_conversion_rate,
          lastInviteAt: row.last_invite_at,
          referralCodesIssued: row.referral_codes_issued,
          referralClicks: row.referral_clicks,
          referralConversions: row.referral_conversions,
          impactScore: row.impact_score,
        }))
      : [];
  const referralCodes: EventReferralCode[] =
    params.view === "codes"
      ? (pageRows as EventReferralCodeRow[]).map((row) => ({
          code: row.code,
          ownerType: row.owner_type,
          ownerId: row.owner_id,
          effectiveUserId: row.effective_user_id,
          ownerEmail: row.owner_email,
          ownerFirstName: row.owner_first_name,
          ownerLastName: row.owner_last_name,
          channelHint: row.channel_hint,
          clicks: row.clicks,
          conversions: row.conversions,
          createdAt: row.created_at,
        }))
      : [];
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
