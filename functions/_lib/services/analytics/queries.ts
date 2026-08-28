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
