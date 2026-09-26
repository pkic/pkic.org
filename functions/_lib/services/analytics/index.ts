import {
  analyticsSummaryResponseSchema,
  donationAnalyticsResponseSchema,
  registrationAnalyticsResponseSchema,
  membershipAnalyticsResponseSchema,
  organizationAnalyticsResponseSchema,
  userAnalyticsResponseSchema,
  type AnalyticsSummary,
  type DonationAnalytics,
  type MembershipAnalytics,
  type OrganizationAnalytics,
  type RegistrationAnalytics,
  type UserAnalytics,
} from "../../../../assets/shared/schemas/analytics";
import type { D1StatementResult, DatabaseLike } from "../../types";
import {
  analyticsWindowBoundaries,
  buildAnalyticsSummaryQueries,
  buildDonationAnalyticsQueries,
  buildRegistrationAnalyticsQueries,
  buildMembershipAnalyticsQueries,
  buildOrganizationAnalyticsQueries,
  buildUserAnalyticsQueries,
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
export async function getAnalyticsSummary(db: DatabaseLike, now = new Date()): Promise<AnalyticsSummary> {
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

  return analyticsSummaryResponseSchema.parse({
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
export async function getRegistrationAnalytics(db: DatabaseLike, now = new Date()): Promise<RegistrationAnalytics> {
  const [statusResult, attendanceResult, weeklyResult, monthlyResult] = await executeAnalyticsQueries(
    db,
    buildRegistrationAnalyticsQueries(analyticsWindowBoundaries(now)),
  );
  const statuses = resultRows<StatusCountRow>(statusResult);

  return registrationAnalyticsResponseSchema.parse({
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
export async function getDonationAnalytics(db: DatabaseLike, now = new Date()): Promise<DonationAnalytics> {
  const [statusResult, currencyResult, totalsResult, dailyResult, weeklyResult, monthlyResult] =
    await executeAnalyticsQueries(db, buildDonationAnalyticsQueries(analyticsWindowBoundaries(now)));
  const statuses = resultRows<StatusCountRow>(statusResult);

  return donationAnalyticsResponseSchema.parse({
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

interface MonthlyCountRow {
  month: string;
  count: number;
}

interface CategoryCountRow {
  code: string;
  label: string;
  count: number;
}

interface PairRow {
  [column: string]: number | null;
}

function monthlySeries(result: D1StatementResult): Array<{ month: string; count: number }> {
  return resultRows<MonthlyCountRow>(result).map((row) => ({ month: row.month, count: Number(row.count) }));
}

/**
 * One row of named totals, with every column defaulted.
 *
 * `SUM` over no rows is NULL, not 0 — an empty database would otherwise fail
 * the response contract's `nonnegative()` rather than answer "none yet".
 */
function totalsRow(result: D1StatementResult, columns: readonly string[]): Record<string, number> {
  const row = firstResult<PairRow>(result);
  return Object.fromEntries(columns.map((column) => [column, Number(row?.[column] ?? 0)]));
}

/**
 * The consortium's roll, counted. One D1 batch, like every other page here.
 */
export async function getMembershipAnalytics(db: DatabaseLike, now = new Date()): Promise<MembershipAnalytics> {
  const [statusResult, kindResult, categoryResult, representationResult, joinedResult] = await executeAnalyticsQueries(
    db,
    buildMembershipAnalyticsQueries(analyticsWindowBoundaries(now)),
  );
  const byStatus = resultRows<StatusCountRow>(statusResult);

  return membershipAnalyticsResponseSchema.parse({
    generatedAt: now.toISOString(),
    members: {
      total: countTotal(byStatus),
      byStatus: countMap(byStatus),
      byKind: countMap(resultRows<StatusCountRow>(kindResult)),
      byCategory: resultRows<CategoryCountRow>(categoryResult).map((row) => ({
        code: row.code,
        label: row.label,
        count: Number(row.count),
      })),
      representation: totalsRow(representationResult, ["withRepresentatives", "withoutRepresentatives"]),
      joinedMonthly: monthlySeries(joinedResult),
    },
  });
}

/** Organization records, and how many of them are members. */
export async function getOrganizationAnalytics(db: DatabaseLike, now = new Date()): Promise<OrganizationAnalytics> {
  const [totalsResult, representationResult, createdResult] = await executeAnalyticsQueries(
    db,
    buildOrganizationAnalyticsQueries(analyticsWindowBoundaries(now)),
  );

  return organizationAnalyticsResponseSchema.parse({
    generatedAt: now.toISOString(),
    organizations: {
      ...totalsRow(totalsResult, ["total", "members", "recordedOnly", "withLogo", "withWebsite"]),
      ...totalsRow(representationResult, ["withRepresentatives", "withoutRepresentatives"]),
      createdMonthly: monthlySeries(createdResult),
    },
  });
}

/** Accounts: standing, role, and whether they act in any capacity. */
export async function getUserAnalytics(db: DatabaseLike, now = new Date()): Promise<UserAnalytics> {
  const [totalsResult, roleResult, reachResult, createdResult] = await executeAnalyticsQueries(
    db,
    buildUserAnalyticsQueries(analyticsWindowBoundaries(now)),
  );

  return userAnalyticsResponseSchema.parse({
    generatedAt: now.toISOString(),
    users: {
      ...totalsRow(totalsResult, ["total", "active", "inactive"]),
      byRole: countMap(resultRows<StatusCountRow>(roleResult)),
      ...totalsRow(reachResult, ["withIdentities", "withoutIdentities"]),
      createdMonthly: monthlySeries(createdResult),
    },
  });
}
