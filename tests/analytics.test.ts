import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import {
  analyticsSummaryResponseSchema,
  donationAnalyticsResponseSchema,
  registrationAnalyticsResponseSchema,
} from "../assets/shared/schemas/analytics";
import {
  analyticsWindowBoundaries,
  buildAnalyticsSummaryQueries,
  buildDonationAnalyticsQueries,
  buildRegistrationAnalyticsQueries,
  RECENT_ACTIVITY_SQL,
  REGISTRATIONS_MONTHLY_SQL,
  REGISTRATIONS_WEEKLY_SQL,
  DONATIONS_DAILY_SQL,
  DONATIONS_MONTHLY_SQL,
  DONATIONS_WEEKLY_SQL,
  TOP_EVENTS_SQL,
} from "../functions/_lib/services/analytics";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";

async function call(path: string, token?: string): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function adminToken(): Promise<string> {
  await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(
    env.DB,
    "SELECT id FROM users WHERE normalized_email = 'admin@pkic.org'",
  );
  return createAdminSession(env.DB, admin.id, `analytics-${crypto.randomUUID()}`);
}

async function staffToken(permission: "analytics:read" | "audit:read"): Promise<string> {
  const userId = await insertUser(
    env.DB,
    `analytics-${permission.replace(":", "-")}-${crypto.randomUUID()}@example.test`,
  );
  await env.DB.prepare(
    `INSERT INTO permission_grants
       (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
     VALUES (?, ?, ?, NULL, NULL, ?, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), userId, permission, userId)
    .run();
  return createAdminSession(env.DB, userId, `analytics-staff-${crypto.randomUUID()}`);
}

describe("analytics", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("exposes three focused, schema-validated analytics projections", async () => {
    const token = await adminToken();
    const summary = await call("/api/v1/analytics/summary", token);
    const registrations = await call("/api/v1/analytics/registrations", token);
    const donations = await call("/api/v1/analytics/donations", token);

    expect(summary.status).toBe(200);
    expect(registrations.status).toBe(200);
    expect(donations.status).toBe(200);
    expect(analyticsSummaryResponseSchema.parse(await summary.json()).topEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: "pqc-2026" })]),
    );
    expect(registrationAnalyticsResponseSchema.parse(await registrations.json()).registrations).toMatchObject({
      total: 0,
      weekly: [],
      monthly: [],
    });
    expect(donationAnalyticsResponseSchema.parse(await donations.json()).donations).toMatchObject({
      totals: { grossUsd: 0, netUsd: 0 },
      daily: [],
      weekly: [],
      monthly: [],
    });
  });

  it("requires a live user-backed global analytics permission", async () => {
    const analyticsReader = await staffToken("analytics:read");
    const unrelatedReader = await staffToken("audit:read");

    expect((await call("/api/v1/analytics/summary", analyticsReader)).status).toBe(200);
    expect((await call("/api/v1/analytics/summary", unrelatedReader)).status).toBe(403);
    expect((await call("/api/v1/analytics/summary")).status).toBe(401);
    expect((await call("/api/v1/analytics/summary", env.ADMIN_API_KEY ?? "test-admin-key")).status).toBe(403);
  });

  it("does not retain the former System API path", async () => {
    const token = await adminToken();
    expect((await call("/api/v1/system/analytics/summary", token)).status).toBe(404);
  });

  it("keeps every projection to one D1 batch with only the queries needed by that section", () => {
    const windows = analyticsWindowBoundaries(new Date("2026-08-28T12:00:00.000Z"));
    expect(buildAnalyticsSummaryQueries(windows)).toHaveLength(7);
    expect(buildRegistrationAnalyticsQueries(windows)).toHaveLength(4);
    expect(buildDonationAnalyticsQueries(windows)).toHaveLength(6);
    expect(buildAnalyticsSummaryQueries(windows).map((query) => query.sql)).not.toContain(REGISTRATIONS_WEEKLY_SQL);
    expect(buildAnalyticsSummaryQueries(windows).map((query) => query.sql)).not.toContain(DONATIONS_DAILY_SQL);
    expect(buildRegistrationAnalyticsQueries(windows).map((query) => query.sql)).not.toContain(DONATIONS_MONTHLY_SQL);
  });

  it("uses bounded date indexes for time-series work and an event-first index for top events", async () => {
    const windows = analyticsWindowBoundaries(new Date("2026-08-28T12:00:00.000Z"));
    const statements = [
      { sql: RECENT_ACTIVITY_SQL, values: [windows.recent, windows.recent] },
      { sql: REGISTRATIONS_WEEKLY_SQL, values: [windows.weekly] },
      { sql: REGISTRATIONS_MONTHLY_SQL, values: [windows.monthly] },
      { sql: DONATIONS_DAILY_SQL, values: [windows.recent] },
      { sql: DONATIONS_WEEKLY_SQL, values: [windows.weekly] },
      { sql: DONATIONS_MONTHLY_SQL, values: [windows.monthly] },
      { sql: TOP_EVENTS_SQL, values: [] },
    ];
    const details = (
      await Promise.all(
        statements.map((statement) =>
          env.DB.prepare(`EXPLAIN QUERY PLAN ${statement.sql}`)
            .bind(...statement.values)
            .all<{ detail: string }>(),
        ),
      )
    )
      .flatMap((plan) => plan.results.map((row) => row.detail))
      .join("\n");

    expect(details).toContain("idx_registrations_created_at");
    expect(details).toContain("idx_invites_created_at");
    expect(details).toContain("idx_donations_created_at");
    expect(details).toContain("SEARCH r USING INDEX sqlite_autoindex_registrations_4 (event_id=?)");
  });
});
