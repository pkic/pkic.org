import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { currentUserDonationsListResponseSchema } from "../assets/shared/schemas/current-user-donations";
import {
  buildCurrentUserDonationsPageQuery,
  listCurrentUserDonations,
} from "../functions/_lib/services/donations/current-user-read-model";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { insertIndividualMember, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function verifyPrimaryEmail(userId: string): Promise<void> {
  await env.DB.prepare("UPDATE users SET email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .bind(userId)
    .run();
}

async function insertDonation(
  email: string,
  overrides: { grossAmount?: number; currency?: string; status?: string; source?: string | null } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO donations
       (id, checkout_session_id, name, email, currency, gross_amount, status, source, created_at)
     VALUES (?, ?, 'A Donor', ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(
      id,
      `cs_test_${crypto.randomUUID()}`,
      email,
      overrides.currency ?? "usd",
      overrides.grossAmount ?? 5000,
      overrides.status ?? "completed",
      overrides.source ?? null,
    )
    .run();
  return id;
}

function getAs(token: string, path: string): Promise<Response> {
  return callApi(env, path, { headers: { authorization: `Bearer ${token}` } });
}

beforeEach(resetDb);

describe("GET /api/v1/users/current/donations", () => {
  it("rejects an unauthenticated caller", async () => {
    expect((await callApi(env, "/api/v1/users/current/donations")).status).toBe(401);
  });

  it("allows a staff-only identity with no member capacity to read its own donations", async () => {
    const email = `current-donations-staff-${crypto.randomUUID()}@example.test`;
    const staffOnlyUserId = await insertUser(env.DB, email);
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(staffOnlyUserId).run();
    await verifyPrimaryEmail(staffOnlyUserId);
    const donationId = await insertDonation(email);
    const token = await createMemberSession(env.DB, staffOnlyUserId, `current-donations-staff-${crypto.randomUUID()}`);

    const response = await getAs(token, "/api/v1/users/current/donations");
    expect(response.status, await response.clone().text()).toBe(200);
    const page = currentUserDonationsListResponseSchema.parse(await response.json());
    expect(page.donations.map((d) => d.id)).toEqual([donationId]);
  });

  it("matches only a verified primary email, excludes other donors, and orders newest first", async () => {
    const email = `current-donations-user-${crypto.randomUUID()}@example.test`;
    const { userId } = await insertIndividualMember(env.DB, "H6", email);
    await verifyPrimaryEmail(userId);
    const token = await createMemberSession(env.DB, userId, `current-donations-${crypto.randomUUID()}`);

    const older = await insertDonation(email, { grossAmount: 2500, source: "newsletter" });
    await env.DB.prepare("UPDATE donations SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").bind(older).run();
    const newer = await insertDonation(email, { grossAmount: 10000, source: "conference" });
    await env.DB.prepare("UPDATE donations SET created_at = '2026-06-01T00:00:00.000Z' WHERE id = ?").bind(newer).run();
    // A donation entered under a different donor's email must never appear.
    await insertDonation(`current-donations-someone-else-${crypto.randomUUID()}@example.test`);

    const response = await getAs(token, "/api/v1/users/current/donations?limit=20&offset=0");
    expect(response.status, await response.clone().text()).toBe(200);
    const page = currentUserDonationsListResponseSchema.parse(await response.json());
    expect(page.donations.map((d) => d.id)).toEqual([newer, older]);
    expect(page.page.total).toBe(2);
    expect(page.donations[0]).toMatchObject({
      grossAmount: 10000,
      currency: "usd",
      status: "completed",
      source: "conference",
    });

    // Parity: the route is a thin wrapper over the service, not a second policy.
    const direct = await listCurrentUserDonations(env.DB, userId, { limit: 20, offset: 0 });
    expect(direct.donations.map((d) => d.id)).toEqual([newer, older]);
    expect(direct.total).toBe(page.page.total);

    // Bounded, deterministic pagination.
    const firstPage = currentUserDonationsListResponseSchema.parse(
      await (await getAs(token, "/api/v1/users/current/donations?limit=1&offset=0")).json(),
    );
    expect(firstPage.donations[0]!.id).toBe(newer);
    expect(firstPage.page).toMatchObject({ limit: 1, offset: 0, total: 2, hasMore: true });
    const secondPage = currentUserDonationsListResponseSchema.parse(
      await (await getAs(token, "/api/v1/users/current/donations?limit=1&offset=1")).json(),
    );
    expect(secondPage.donations[0]!.id).toBe(older);
    expect(secondPage.page).toMatchObject({ limit: 1, offset: 1, total: 2, hasMore: false });
  });

  it("excludes donations recorded under an email the caller has not verified", async () => {
    const email = `current-donations-unverified-${crypto.randomUUID()}@example.test`;
    const { userId } = await insertIndividualMember(env.DB, "H6", email);
    // Deliberately not verified.
    const token = await createMemberSession(env.DB, userId, `current-donations-unverified-${crypto.randomUUID()}`);
    await insertDonation(email);

    const response = await getAs(token, "/api/v1/users/current/donations");
    const page = currentUserDonationsListResponseSchema.parse(await response.json());
    expect(page.donations).toEqual([]);
  });
});

describe("buildCurrentUserDonationsPageQuery D1 query plan", () => {
  beforeEach(resetDb);

  it("produces an executable EXPLAIN QUERY PLAN", async () => {
    const query = buildCurrentUserDonationsPageQuery("some-user-id", { limit: 50, offset: 0 });
    const { pageSql, countSql, bindings, countBindings } = buildOffsetPageSql(query);
    const [pagePlan, countPlan] = await Promise.all([
      env.DB.prepare(`EXPLAIN QUERY PLAN ${pageSql}`)
        .bind(...bindings, query.limit, query.offset)
        .all(),
      env.DB.prepare(`EXPLAIN QUERY PLAN ${countSql}`)
        .bind(...countBindings)
        .all(),
    ]);
    expect(pagePlan.results.length).toBeGreaterThan(0);
    expect(countPlan.results.length).toBeGreaterThan(0);
  });
});
