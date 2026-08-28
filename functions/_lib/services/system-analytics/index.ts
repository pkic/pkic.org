import {
  systemAnalyticsSummaryResponseSchema,
  systemDonationAnalyticsResponseSchema,
  systemRegistrationAnalyticsResponseSchema,
  type SystemAnalyticsSummary,
  type SystemDonationAnalytics,
  type SystemRegistrationAnalytics,
} from "../../../../assets/shared/schemas/system-analytics";
import type { D1StatementResult, DatabaseLike } from "../../types";
import {
  analyticsWindowBoundaries,
  buildAnalyticsSummaryQueries,
  buildDonationAnalyticsQueries,
  buildRegistrationAnalyticsQueries,
  type AnalyticsQuery,
} from "./queries";

interface StatusCountRow {
  status: string;
  count: number;
}

interface DonationTotalsRow {
  grossUsd: number | null;
  netUsd: number | null;
}

function resultRows<T>(result: D1StatementResult): T[] {
  return (result.results ?? []) as T[];
}

function firstResult<T>(result: D1StatementResult): T | null {
  return resultRows<T>(result)[0] ?? null;
}

function countMap(rows: StatusCountRow[]): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
}

function countTotal(rows: StatusCountRow[]): number {
  return rows.reduce((total, row) => total + Number(row.count), 0);
}

async function executeAnalyticsQueries(db: DatabaseLike, queries: AnalyticsQuery[]): Promise<D1StatementResult[]> {
  return db.batch(queries.map((query) => db.prepare(query.sql).bind(...query.values)));
}

function donationTotals(result: D1StatementResult) {
  const row = firstResult<DonationTotalsRow>(result);
  return { grossUsd: Number(row?.grossUsd ?? 0), netUsd: Number(row?.netUsd ?? 0) };
}

/** Platform summary with no detailed time series. All reads use one D1 batch. */
export async function getSystemAnalyticsSummary(db: DatabaseLike, now = new Date()): Promise<SystemAnalyticsSummary> {
  const [
    registrationsResult,
    invitesResult,
    emailResult,
    topEventsResult,
    activityResult,
    donationsResult,
    totalsResult,
  ] = await executeAnalyticsQueries(db, buildAnalyticsSummaryQueries(analyticsWindowBoundaries(now)));
  const registrations = resultRows<StatusCountRow>(registrationsResult);
  const invites = resultRows<StatusCountRow>(invitesResult);
  const email = resultRows<StatusCountRow>(emailResult);
  const donations = resultRows<StatusCountRow>(donationsResult);

  return systemAnalyticsSummaryResponseSchema.parse({
    generatedAt: now.toISOString(),
    registrations: { byStatus: countMap(registrations), total: countTotal(registrations) },
    invites: { byStatus: countMap(invites), total: countTotal(invites) },
    email: {
      outboxByStatus: countMap(email),
      totalQueued: email.find((row) => row.status === "queued")?.count ?? 0,
      totalFailed: email.find((row) => row.status === "failed")?.count ?? 0,
      totalBounced: email.find((row) => row.status === "bounced")?.count ?? 0,
    },
    donations: { byStatus: countMap(donations), totals: donationTotals(totalsResult) },
    topEvents: resultRows(topEventsResult),
    recentActivity: resultRows(activityResult),
  });
}

/** Registration detail is loaded only when its analytics tab is selected. */
export async function getSystemRegistrationAnalytics(
  db: DatabaseLike,
  now = new Date(),
): Promise<SystemRegistrationAnalytics> {
  const [statusResult, attendanceResult, weeklyResult, monthlyResult] = await executeAnalyticsQueries(
    db,
    buildRegistrationAnalyticsQueries(analyticsWindowBoundaries(now)),
  );
  const statuses = resultRows<StatusCountRow>(statusResult);

  return systemRegistrationAnalyticsResponseSchema.parse({
    generatedAt: now.toISOString(),
    registrations: {
      byStatus: countMap(statuses),
      byAttendanceType: Object.fromEntries(
        resultRows<{ attendance_type: string; count: number }>(attendanceResult).map((row) => [
          row.attendance_type,
          Number(row.count),
        ]),
      ),
      total: countTotal(statuses),
      weekly: resultRows(weeklyResult),
      monthly: resultRows(monthlyResult),
    },
  });
}

/** Donation detail is loaded only when its analytics tab is selected. */
export async function getSystemDonationAnalytics(db: DatabaseLike, now = new Date()): Promise<SystemDonationAnalytics> {
  const [statusResult, currencyResult, totalsResult, dailyResult, weeklyResult, monthlyResult] =
    await executeAnalyticsQueries(db, buildDonationAnalyticsQueries(analyticsWindowBoundaries(now)));
  const statuses = resultRows<StatusCountRow>(statusResult);

  return systemDonationAnalyticsResponseSchema.parse({
    generatedAt: now.toISOString(),
    donations: {
      byStatus: countMap(statuses),
      byCurrency: resultRows(currencyResult),
      totals: donationTotals(totalsResult),
      daily: resultRows(dailyResult),
      weekly: resultRows(weeklyResult),
      monthly: resultRows(monthlyResult),
    },
  });
}

export * from "./queries";
