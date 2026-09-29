export interface AnalyticsQuery {
  sql: string;
  values: unknown[];
}

export interface AnalyticsWindowBoundaries {
  recent: string;
  weekly: string;
  monthly: string;
}

function isoDaysBefore(now: Date, days: number): string {
  const value = new Date(now);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString();
}

function isoMonthsBefore(now: Date, months: number): string {
  const value = new Date(now);
  value.setUTCMonth(value.getUTCMonth() - months);
  return value.toISOString();
}

export function analyticsWindowBoundaries(now: Date): AnalyticsWindowBoundaries {
  return {
    recent: isoDaysBefore(now, 30),
    weekly: isoDaysBefore(now, 84),
    monthly: isoMonthsBefore(now, 12),
  };
}

export const REGISTRATIONS_BY_STATUS_SQL = `
  SELECT status, COUNT(*) AS count
  FROM registrations
  GROUP BY status`;

export const REGISTRATIONS_BY_ATTENDANCE_TYPE_SQL = `
  SELECT attendance_type, COUNT(*) AS count
  FROM registrations
  WHERE status = 'registered'
  GROUP BY attendance_type`;

export const INVITES_BY_STATUS_SQL = `
  SELECT status, COUNT(*) AS count
  FROM invites
  GROUP BY status`;

export const EMAIL_OUTBOX_BY_STATUS_SQL = `
  SELECT status, COUNT(*) AS count
  FROM email_outbox
  GROUP BY status`;

export const TOP_EVENTS_SQL = `
  SELECT e.slug,
         e.name,
         COUNT(CASE WHEN r.status = 'registered' THEN 1 END) AS confirmed,
         COUNT(r.id) AS total
  FROM events e
  LEFT JOIN registrations r ON r.event_id = e.id
  GROUP BY e.id
  ORDER BY confirmed DESC, e.id ASC
  LIMIT 10`;

export const RECENT_ACTIVITY_SQL = `
  WITH registration_days AS (
    SELECT date(created_at) AS date, COUNT(*) AS registrations
    FROM registrations
    WHERE created_at >= ?
    GROUP BY date(created_at)
  ),
  invite_days AS (
    SELECT date(created_at) AS date, COUNT(*) AS invites
    FROM invites
    WHERE created_at >= ?
    GROUP BY date(created_at)
  ),
  activity_days AS (
    SELECT date FROM registration_days
    UNION
    SELECT date FROM invite_days
  )
  SELECT activity_days.date,
         COALESCE(registration_days.registrations, 0) AS registrations,
         COALESCE(invite_days.invites, 0) AS invites
  FROM activity_days
  LEFT JOIN registration_days ON registration_days.date = activity_days.date
  LEFT JOIN invite_days ON invite_days.date = activity_days.date
  ORDER BY activity_days.date ASC`;

export const DONATIONS_BY_STATUS_SQL = `
  SELECT status, COUNT(*) AS count
  FROM donations
  GROUP BY status`;

export const DONATION_TOTALS_SQL = `
  SELECT SUM(
           CASE WHEN status = 'completed' AND settled_currency = 'usd' THEN settled_amount
                WHEN status = 'completed' AND currency = 'usd' THEN gross_amount
                ELSE 0 END
         ) AS grossUsd,
         SUM(
           CASE WHEN status = 'completed' AND currency = 'usd' AND net_amount IS NOT NULL THEN net_amount
                WHEN status = 'completed' AND settled_currency = 'usd' THEN settled_amount
                ELSE 0 END
         ) AS netUsd
  FROM donations`;

export const REGISTRATIONS_WEEKLY_SQL = `
  SELECT strftime('%Y-W%W', created_at) AS week, COUNT(*) AS count
  FROM registrations
  WHERE created_at >= ?
  GROUP BY strftime('%Y-W%W', created_at)
  ORDER BY week ASC`;

export const REGISTRATIONS_MONTHLY_SQL = `
  SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS count
  FROM registrations
  WHERE created_at >= ?
  GROUP BY strftime('%Y-%m', created_at)
  ORDER BY month ASC`;

export const DONATIONS_BY_CURRENCY_SQL = `
  SELECT status,
         currency,
         COUNT(*) AS count,
         SUM(gross_amount) AS totalGross,
         ROUND(AVG(gross_amount)) AS averageGross,
         SUM(net_amount) AS totalNet,
         SUM(CASE WHEN settled_currency = 'usd' THEN settled_amount
                  WHEN currency = 'usd' THEN gross_amount
                  ELSE NULL END) AS totalGrossUsd
  FROM donations
  GROUP BY status, currency
  ORDER BY status, totalGrossUsd DESC NULLS LAST`;

function donationPeriodSql(periodExpression: string, periodAlias: "date" | "week" | "month"): string {
  return `
    SELECT ${periodExpression} AS ${periodAlias},
           COUNT(*) AS count,
           COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completed,
           COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending,
           COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed,
           COUNT(CASE WHEN status = 'expired' THEN 1 END) AS expired,
           SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END) AS gross,
           SUM(CASE WHEN status = 'completed' AND settled_currency = 'usd' THEN settled_amount
                    WHEN status = 'completed' AND currency = 'usd' THEN gross_amount
                    ELSE 0 END) AS grossUsd,
           SUM(CASE WHEN status = 'completed' AND currency = 'usd' AND net_amount IS NOT NULL THEN net_amount
                    WHEN status = 'completed' AND settled_currency = 'usd' THEN settled_amount
                    ELSE 0 END) AS netUsd
    FROM donations
    WHERE created_at >= ?
    GROUP BY ${periodExpression}
    ORDER BY ${periodAlias} ASC`;
}

export const DONATIONS_DAILY_SQL = donationPeriodSql("date(created_at)", "date");
export const DONATIONS_WEEKLY_SQL = donationPeriodSql("strftime('%Y-W%W', created_at)", "week");
export const DONATIONS_MONTHLY_SQL = donationPeriodSql("strftime('%Y-%m', created_at)", "month");

export function buildAnalyticsSummaryQueries(windows: AnalyticsWindowBoundaries): AnalyticsQuery[] {
  return [
    { sql: REGISTRATIONS_BY_STATUS_SQL, values: [] },
    { sql: INVITES_BY_STATUS_SQL, values: [] },
    { sql: EMAIL_OUTBOX_BY_STATUS_SQL, values: [] },
    { sql: TOP_EVENTS_SQL, values: [] },
    { sql: RECENT_ACTIVITY_SQL, values: [windows.recent, windows.recent] },
    { sql: DONATIONS_BY_STATUS_SQL, values: [] },
    { sql: DONATION_TOTALS_SQL, values: [] },
  ];
}

export function buildRegistrationAnalyticsQueries(windows: AnalyticsWindowBoundaries): AnalyticsQuery[] {
  return [
    { sql: REGISTRATIONS_BY_STATUS_SQL, values: [] },
    { sql: REGISTRATIONS_BY_ATTENDANCE_TYPE_SQL, values: [] },
    { sql: REGISTRATIONS_WEEKLY_SQL, values: [windows.weekly] },
    { sql: REGISTRATIONS_MONTHLY_SQL, values: [windows.monthly] },
  ];
}

export function buildDonationAnalyticsQueries(windows: AnalyticsWindowBoundaries): AnalyticsQuery[] {
  return [
    { sql: DONATIONS_BY_STATUS_SQL, values: [] },
    { sql: DONATIONS_BY_CURRENCY_SQL, values: [] },
    { sql: DONATION_TOTALS_SQL, values: [] },
    { sql: DONATIONS_DAILY_SQL, values: [windows.recent] },
    { sql: DONATIONS_WEEKLY_SQL, values: [windows.weekly] },
    { sql: DONATIONS_MONTHLY_SQL, values: [windows.monthly] },
  ];
}

/*
 * ── The subject analytics: membership, organizations, accounts ──────────────
 *
 * One page per domain, under the domain it measures (#39). Each is a set of
 * bounded aggregates: counts D1 computes, and one twelve-month series. None
 * of them reads a row the page then has to add up, because that would be the
 * frontend doing a query's job.
 */

/**
 * A membership's live representatives, as a condition rather than a join.
 *
 * The same reach `staff-directory.ts` uses for its `representativeCount`: a
 * capacity whose identity has started, has not ended, and is not blocked.
 * Written once here as the shared fragment both counts below need.
 */
const LIVE_REPRESENTATIVES = `(
  SELECT COUNT(*)
    FROM identity_member_capacities capacity
    JOIN identities identity ON identity.id = capacity.identity_id
   WHERE capacity.member_id = m.id
     AND identity.started_at IS NOT NULL
     AND identity.ended_at IS NULL
     AND identity.blocked_at IS NULL
)`;

export const MEMBERS_BY_STATUS_SQL = `
  SELECT status, COUNT(*) AS count
  FROM members
  GROUP BY status`;

/** `member_type` under the name every other status count uses, so one mapper reads them all. */
export const MEMBERS_BY_KIND_SQL = `
  SELECT member_type AS status, COUNT(*) AS count
  FROM members
  GROUP BY member_type`;

/**
 * Category with its label, joined where the label lives.
 *
 * A code on its own is not a fact a reader can use — "A" says nothing — which
 * is the same complaint #53 made about the organization form's category
 * select.
 */
export const MEMBERS_BY_CATEGORY_SQL = `
  SELECT mca.category_code AS code,
         mc.label AS label,
         COUNT(*) AS count
  FROM members m
  JOIN member_category_assignments mca ON mca.member_id = m.id
  JOIN membership_categories mc ON mc.code = mca.category_code
  GROUP BY mca.category_code, mc.label
  ORDER BY mca.category_code ASC`;

export const MEMBERS_REPRESENTATION_SQL = `
  SELECT SUM(CASE WHEN ${LIVE_REPRESENTATIVES} > 0 THEN 1 ELSE 0 END) AS withRepresentatives,
         SUM(CASE WHEN ${LIVE_REPRESENTATIVES} = 0 THEN 1 ELSE 0 END) AS withoutRepresentatives
  FROM members m`;

/** When memberships began, not when their rows were written. */
export const MEMBERS_JOINED_MONTHLY_SQL = `
  SELECT strftime('%Y-%m', COALESCE(member_since, created_at)) AS month, COUNT(*) AS count
  FROM members
  WHERE COALESCE(member_since, created_at) >= ?
  GROUP BY month
  ORDER BY month ASC`;

/**
 * Every organization, and how many of them hold a membership.
 *
 * The counts are taken in one pass so they cannot disagree about the total,
 * which two separate statements against a moving table can.
 */
export const ORGANIZATIONS_TOTALS_SQL = `
  SELECT COUNT(*) AS total,
         SUM(CASE WHEN m.id IS NOT NULL THEN 1 ELSE 0 END) AS members,
         SUM(CASE WHEN m.id IS NULL THEN 1 ELSE 0 END) AS recordedOnly,
         SUM(CASE WHEN o.logo_r2_key IS NOT NULL AND TRIM(o.logo_r2_key) <> '' THEN 1 ELSE 0 END) AS withLogo,
         SUM(CASE WHEN o.website IS NOT NULL AND TRIM(o.website) <> '' THEN 1 ELSE 0 END) AS withWebsite
  FROM organizations o
  LEFT JOIN members m ON m.organization_id = o.id`;

/** Represented means somebody currently acts for it, whether or not it is a member. */
export const ORGANIZATIONS_REPRESENTATION_SQL = `
  SELECT SUM(CASE WHEN live.count > 0 THEN 1 ELSE 0 END) AS withRepresentatives,
         SUM(CASE WHEN live.count = 0 THEN 1 ELSE 0 END) AS withoutRepresentatives
  FROM organizations o
  JOIN (
    SELECT o2.id AS organization_id,
           (SELECT COUNT(*)
              FROM identities i
             WHERE i.organization_id = o2.id
               AND i.started_at IS NOT NULL
               AND i.ended_at IS NULL
               AND i.blocked_at IS NULL) AS count
      FROM organizations o2
  ) live ON live.organization_id = o.id`;

export const ORGANIZATIONS_CREATED_MONTHLY_SQL = `
  SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS count
  FROM organizations
  WHERE created_at >= ?
  GROUP BY month
  ORDER BY month ASC`;

export const USERS_TOTALS_SQL = `
  SELECT COUNT(*) AS total,
         SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN active = 0 THEN 1 ELSE 0 END) AS inactive
  FROM users`;

export const USERS_BY_ROLE_SQL = `
  SELECT role AS status, COUNT(*) AS count
  FROM users
  GROUP BY role`;

/**
 * Whether the account acts in any capacity at all.
 *
 * An account with no live identity is not broken: contacts, event attendees
 * and people whose term ended all sign in and represent nobody. It is the
 * number that says how much of the directory is participation and how much is
 * address book.
 */
export const USERS_IDENTITY_REACH_SQL = `
  SELECT SUM(CASE WHEN live.count > 0 THEN 1 ELSE 0 END) AS withIdentities,
         SUM(CASE WHEN live.count = 0 THEN 1 ELSE 0 END) AS withoutIdentities
  FROM users u
  JOIN (
    SELECT u2.id AS user_id,
           (SELECT COUNT(*)
              FROM identities i
             WHERE i.user_id = u2.id
               AND i.started_at IS NOT NULL
               AND i.ended_at IS NULL
               AND i.blocked_at IS NULL) AS count
      FROM users u2
  ) live ON live.user_id = u.id`;

export const USERS_CREATED_MONTHLY_SQL = `
  SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS count
  FROM users
  WHERE created_at >= ?
  GROUP BY month
  ORDER BY month ASC`;

export function buildMembershipAnalyticsQueries(windows: AnalyticsWindowBoundaries): AnalyticsQuery[] {
  return [
    { sql: MEMBERS_BY_STATUS_SQL, values: [] },
    { sql: MEMBERS_BY_KIND_SQL, values: [] },
    { sql: MEMBERS_BY_CATEGORY_SQL, values: [] },
    { sql: MEMBERS_REPRESENTATION_SQL, values: [] },
    { sql: MEMBERS_JOINED_MONTHLY_SQL, values: [windows.monthly] },
  ];
}

export function buildOrganizationAnalyticsQueries(windows: AnalyticsWindowBoundaries): AnalyticsQuery[] {
  return [
    { sql: ORGANIZATIONS_TOTALS_SQL, values: [] },
    { sql: ORGANIZATIONS_REPRESENTATION_SQL, values: [] },
    { sql: ORGANIZATIONS_CREATED_MONTHLY_SQL, values: [windows.monthly] },
  ];
}

export function buildUserAnalyticsQueries(windows: AnalyticsWindowBoundaries): AnalyticsQuery[] {
  return [
    { sql: USERS_TOTALS_SQL, values: [] },
    { sql: USERS_BY_ROLE_SQL, values: [] },
    { sql: USERS_IDENTITY_REACH_SQL, values: [] },
    { sql: USERS_CREATED_MONTHLY_SQL, values: [windows.monthly] },
  ];
}
