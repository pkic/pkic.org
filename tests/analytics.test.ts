import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import {
  analyticsSummaryResponseSchema,
  donationAnalyticsResponseSchema,
  membershipAnalyticsResponseSchema,
  organizationAnalyticsResponseSchema,
  registrationAnalyticsResponseSchema,
  userAnalyticsResponseSchema,
} from "../assets/shared/schemas/analytics";
import {
  analyticsWindowBoundaries,
  buildAnalyticsSummaryQueries,
  buildDonationAnalyticsQueries,
  buildRegistrationAnalyticsQueries,
  buildMembershipAnalyticsQueries,
  buildOrganizationAnalyticsQueries,
  buildUserAnalyticsQueries,
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
import { insertIndividualMember, insertOrganization, insertOrgRepresentative, insertUser } from "./helpers/membership";

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

  /*
   * #39 asked for the system-wide analytics panel to be replaced by a page
   * under each domain it measures. These are those pages' read models, and
   * they are checked against seeded rows rather than for a 200: a page of
   * zeroes answers every request successfully and tells the reader nothing.
   */
  it("counts memberships by standing, kind and category, and says which are represented", async () => {
    const token = await adminToken();

    // Two organization memberships — one with somebody seated, one with
    // nobody — and one individual member.
    await insertOrgRepresentative(env.DB, { category: "A" });
    const unrepresented = await insertOrganization(env.DB);
    await env.DB.prepare(
      `INSERT INTO members (id, member_type, organization_id, status, created_at, updated_at)
       VALUES (?, 'organization', ?, 'active', datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), unrepresented)
      .run();
    await insertIndividualMember(env.DB, "H6");

    const response = await call("/api/v1/analytics/members", token);
    expect(response.status).toBe(200);
    const { members } = membershipAnalyticsResponseSchema.parse(await response.json());

    // One row per membership, never one per representative.
    expect(members.total).toBe(3);
    expect(members.byKind).toMatchObject({ organization: 2, individual: 1 });
    expect(members.byStatus.active).toBe(3);
    // A membership nobody acts for is the one worth surfacing.
    expect(members.representation).toEqual({ withRepresentatives: 2, withoutRepresentatives: 1 });
    // Categories arrive named, not as bare codes.
    expect(members.byCategory).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "A", label: expect.any(String), count: 1 })]),
    );
    expect(members.byCategory.every((entry) => entry.label.length > 0)).toBe(true);
  });

  it("separates organizations that hold a membership from those merely recorded", async () => {
    const token = await adminToken();
    await insertOrgRepresentative(env.DB, { category: "A" });
    // An attendee's employer: a record the consortium keeps, and not a member.
    await insertOrganization(env.DB, "Recorded Only Ltd");

    const response = await call("/api/v1/analytics/organizations", token);
    expect(response.status).toBe(200);
    const { organizations } = organizationAnalyticsResponseSchema.parse(await response.json());

    expect(organizations.total).toBe(2);
    expect(organizations.members).toBe(1);
    expect(organizations.recordedOnly).toBe(1);
    expect(organizations.members + organizations.recordedOnly).toBe(organizations.total);
    expect(organizations.withRepresentatives).toBe(1);
    expect(organizations.withoutRepresentatives).toBe(1);
  });

  it("counts accounts by standing and role, and how many act in a capacity", async () => {
    const token = await adminToken();
    const { userId } = await insertOrgRepresentative(env.DB, { category: "A" });
    // An account that can sign in and represents nobody.
    const contactOnly = await insertUser(env.DB, `contact-${crypto.randomUUID()}@example.test`);

    const response = await call("/api/v1/analytics/users", token);
    expect(response.status).toBe(200);
    const { users } = userAnalyticsResponseSchema.parse(await response.json());

    expect(users.total).toBeGreaterThanOrEqual(2);
    expect(users.active + users.inactive).toBe(users.total);
    expect(users.withIdentities + users.withoutIdentities).toBe(users.total);
    // The representative acts in a capacity; the bare contact does not.
    expect(users.withIdentities).toBeGreaterThanOrEqual(1);
    expect(users.withoutIdentities).toBeGreaterThanOrEqual(1);
    expect(Object.values(users.byRole).reduce((sum, count) => sum + count, 0)).toBe(users.total);
    expect(userId).not.toBe(contactOnly);
  });

  it("refuses the subject analytics pages without the analytics permission", async () => {
    const unrelatedReader = await staffToken("audit:read");
    for (const path of ["/api/v1/analytics/members", "/api/v1/analytics/organizations", "/api/v1/analytics/users"]) {
      expect((await call(path, unrelatedReader)).status).toBe(403);
      expect((await call(path)).status).toBe(401);
    }
  });

  it("keeps every projection to one D1 batch with only the queries needed by that section", () => {
    const windows = analyticsWindowBoundaries(new Date("2026-08-28T12:00:00.000Z"));
    expect(buildAnalyticsSummaryQueries(windows)).toHaveLength(7);
    expect(buildRegistrationAnalyticsQueries(windows)).toHaveLength(4);
    expect(buildDonationAnalyticsQueries(windows)).toHaveLength(6);
    expect(buildMembershipAnalyticsQueries(windows)).toHaveLength(5);
    expect(buildOrganizationAnalyticsQueries(windows)).toHaveLength(3);
    expect(buildUserAnalyticsQueries(windows)).toHaveLength(4);
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
