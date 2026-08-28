/**
 * donations-management.test.ts
 *
 * Covers permission-derived donation management under the canonical resource API.
 * unbounded/manually-parsed handler onto the shared Chanfana query schema
 * + openApiRoute pattern every other admin list endpoint uses (see
 * functions/api/v1/admin/organizations/index.ts).
 */
import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import {
  donationPromotersListResponseSchema,
  donationsListResponseSchema,
} from "../assets/shared/schemas/donation-management";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { getCurrentUserBackedAdmin } from "../functions/_lib/auth/admin";
import { reconcileDonations } from "../functions/_lib/services/donations/reconciliation";

function request(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    request(token, path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function createStaffToken(permission: "donations:read" | "donations:sync" | "audit:read") {
  const userId = await insertUser(
    env.DB,
    `donations-${permission.replace(":", "-")}-${crypto.randomUUID()}@test.invalid`,
  );
  const grantId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO permission_grants
       (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
     VALUES (?, ?, ?, NULL, NULL, ?, datetime('now'))`,
  )
    .bind(grantId, userId, permission, userId)
    .run();
  const sessionId = `donations-staff-${crypto.randomUUID()}`;
  const token = await createAdminSession(env.DB, userId, sessionId);
  const session = await env.DB.prepare("SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(userId)
    .first<{ id: string }>();
  if (!session) throw new Error("Donation staff session was not created");
  return {
    userId,
    grantId,
    sessionId: session.id,
    token,
  };
}

async function insertDonation(opts: {
  checkoutSessionId: string;
  status: string;
  name?: string;
  email?: string;
  grossAmount?: number;
  createdAt?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO donations (id, checkout_session_id, status, name, email, currency, gross_amount, completed_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'usd', ?, ${opts.status === "completed" ? "datetime('now')" : "NULL"}, ?)`,
  )
    .bind(
      id,
      opts.checkoutSessionId,
      opts.status,
      opts.name ?? "Alice Donor",
      opts.email ?? "alice@example.test",
      opts.grossAmount ?? 5000,
      opts.createdAt ?? new Date().toISOString(),
    )
    .run();
  return id;
}

function stripeCheckoutSession(sessionId: string, paymentStatus: "paid" | "unpaid") {
  return {
    id: sessionId,
    status: "complete",
    payment_status: paymentStatus,
    payment_intent: `pi_${sessionId}`,
    payment_method_types: ["card"],
    amount_total: 5000,
    currency: "usd",
    customer_email: "",
  };
}

describe("GET /api/v1/donations", () => {
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminToken = await createAdminSession(env.DB, adminRow.id, "admin-donations-token");

    await insertDonation({
      checkoutSessionId: "cs_1",
      status: "completed",
      name: "Amy Donor",
      grossAmount: 1000,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await insertDonation({
      checkoutSessionId: "cs_2",
      status: "pending",
      name: "Zed Donor",
      grossAmount: 3000,
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    await insertDonation({
      checkoutSessionId: "cs_3",
      status: "expired",
      name: "Mia Donor",
      grossAmount: 2000,
      createdAt: "2026-01-03T00:00:00.000Z",
    });
  });

  it("lists every donation with a status-count summary, default sort newest-first", async () => {
    const response = await call(adminToken, "/api/v1/donations");
    expect(response.status).toBe(200);
    const body = donationsListResponseSchema.parse(await response.json());
    expect(body.donations.map((d) => d.checkout_session_id)).toEqual(["cs_3", "cs_2", "cs_1"]);
    expect(body.page).toEqual({ limit: 100, offset: 0, total: 3, hasMore: false });
    expect(body.summary).toEqual({
      byStatus: { completed: 1, pending: 1, expired: 1 },
      backfillable: 1,
      syncable: 2,
    });
  });

  it("filters by status", async () => {
    const response = await call(adminToken, "/api/v1/donations?status=pending");
    expect(response.status).toBe(200);
    const body = donationsListResponseSchema.parse(await response.json());
    expect(body.donations.map((d) => d.checkout_session_id)).toEqual(["cs_2"]);
    expect(body.page.total).toBe(1);
    // summary is unaffected by the status filter — still every status's count.
    expect(body.summary).toEqual({
      byStatus: { completed: 1, pending: 1, expired: 1 },
      backfillable: 1,
      syncable: 2,
    });
  });

  it("rejects an unknown status value instead of silently matching nothing", async () => {
    const response = await call(adminToken, "/api/v1/donations?status=bogus");
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("sorts by an allowlisted column ascending/descending", async () => {
    const asc = await call(adminToken, "/api/v1/donations?sort=gross_amount");
    const ascBody = (await asc.json()) as { donations: Array<{ checkout_session_id: string }> };
    expect(ascBody.donations.map((d) => d.checkout_session_id)).toEqual(["cs_1", "cs_3", "cs_2"]);

    const desc = await call(adminToken, "/api/v1/donations?sort=-gross_amount");
    const descBody = (await desc.json()) as { donations: Array<{ checkout_session_id: string }> };
    expect(descBody.donations.map((d) => d.checkout_session_id)).toEqual(["cs_2", "cs_3", "cs_1"]);
  });

  it("rejects an unknown/unsafe sort column with a 400 instead of silently falling back", async () => {
    const response = await call(
      adminToken,
      `/api/v1/donations?sort=${encodeURIComponent("id; DROP TABLE donations; --")}`,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");

    const stillExists = await queryAll(env.DB, "SELECT id FROM donations");
    expect(stillExists.length).toBe(3);
  });

  it("bounds results with limit/offset", async () => {
    const response = await call(adminToken, "/api/v1/donations?q=donor&limit=1&offset=1&sort=created_at");
    expect(response.status).toBe(200);
    const body = donationsListResponseSchema.parse(await response.json());
    expect(body.donations.map((d) => d.checkout_session_id)).toEqual(["cs_2"]);
    expect(body.page).toEqual({ limit: 1, offset: 1, total: 3, hasMore: true });
    expect(body.summary).toMatchObject({ backfillable: 1, syncable: 2 });
  });

  it("applies free-text search in D1 through the shared list contract", async () => {
    const response = await call(adminToken, "/api/v1/donations?q=zed");
    expect(response.status).toBe(200);
    const body = donationsListResponseSchema.parse(await response.json());
    expect(body.donations.map((donation) => donation.checkout_session_id)).toEqual(["cs_2"]);
    expect(body.page.total).toBe(1);
  });

  it("uses the shared maximum page size", async () => {
    const response = await call(adminToken, "/api/v1/donations?limit=201");
    expect(response.status).toBe(400);
  });
});

describe("donation-management authorization", () => {
  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("separates live read and sync permissions and rejects service identities", async () => {
    const reader = await createStaffToken("donations:read");
    const synchronizer = await createStaffToken("donations:sync");
    const unrelated = await createStaffToken("audit:read");

    expect((await call(reader.token, "/api/v1/donations")).status).toBe(200);
    expect((await call(reader.token, "/api/v1/donations/sync", { method: "POST", body: "{}" })).status).toBe(403);
    expect((await call(synchronizer.token, "/api/v1/donations")).status).toBe(403);
    expect((await call(synchronizer.token, "/api/v1/donations/sync", { method: "POST", body: "{}" })).status).toBe(200);
    expect((await call(unrelated.token, "/api/v1/donations")).status).toBe(403);
    expect((await call(env.ADMIN_API_KEY ?? "test-admin-key", "/api/v1/donations")).status).toBe(403);
    await expect(
      env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'donations_reconciled' AND actor_id = ?")
        .bind(synchronizer.userId)
        .first("count"),
    ).resolves.toBe(1);
  });

  it("removes the legacy admin donation routes", async () => {
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    const token = await createAdminSession(env.DB, admin.id, `legacy-donation-${crypto.randomUUID()}`);
    expect((await call(token, "/api/v1/admin/donations")).status).toBe(404);
    expect((await call(token, "/api/v1/admin/donations/sync", { method: "POST", body: "{}" })).status).toBe(404);
  });

  it("rechecks donations:sync after Stripe I/O and rolls back a revoked operation", async () => {
    const staff = await createStaffToken("donations:sync");
    const actor = await getCurrentUserBackedAdmin(env.DB, staff.userId, staff.sessionId);
    expect(actor).not.toBeNull();
    await insertDonation({ checkoutSessionId: "cs_permission_race", status: "pending", email: "" });
    vi.stubGlobal("fetch", async () => {
      await env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?")
        .bind(staff.grantId)
        .run();
      return Response.json({
        id: "cs_permission_race",
        status: "open",
        payment_status: "unpaid",
        payment_intent: null,
        amount_total: 5000,
        currency: "usd",
        customer_email: "",
      });
    });

    await expect(
      reconcileDonations(
        env.DB,
        env as any,
        { sessionIds: ["cs_permission_race"] },
        {
          actor: actor!,
          stripeKey: "sk_test_permission_race",
          appBaseUrl: "https://app.test",
          limit: 50,
        },
      ),
    ).rejects.toMatchObject({ status: 409, code: "DONATION_SYNC_AUTHORIZATION_CHANGED" });
    await expect(
      env.DB.prepare("SELECT status FROM donations WHERE checkout_session_id = ?")
        .bind("cs_permission_race")
        .first("status"),
    ).resolves.toBe("pending");
  });
});

describe("POST /api/v1/donations/sync", () => {
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
    adminToken = await createAdminSession(env.DB, admin.id, "admin-donation-sync-token");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("rejects malformed or over-limit input instead of treating it as sync-all", async () => {
    const malformed = await call(adminToken, "/api/v1/donations/sync", {
      method: "POST",
      body: "{broken",
    });
    expect(malformed.status).toBe(400);

    const overLimit = await call(adminToken, "/api/v1/donations/sync", {
      method: "POST",
      body: JSON.stringify({ sessionIds: Array.from({ length: 51 }, (_, index) => `cs_${index}`) }),
    });
    expect(overLimit.status).toBe(400);
  });

  it("filters and caps sync-all in D1 before contacting Stripe", async () => {
    const statements = Array.from({ length: 60 }, (_, index) =>
      env.DB.prepare(
        `INSERT INTO donations
           (id, checkout_session_id, status, name, email, currency, gross_amount, created_at)
         VALUES (?, ?, 'pending', 'Bounded Donor', ?, 'usd', 1000, ?)`,
      ).bind(
        crypto.randomUUID(),
        `cs_bounded_${index}`,
        `bounded-${index}@example.test`,
        new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      ),
    );
    await env.DB.batch(statements);
    const stripeFetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        Response.json({
          id: String(url).split("/").pop(),
          status: "open",
          payment_status: "unpaid",
          payment_intent: null,
          amount_total: 1000,
          currency: "usd",
          customer_email: "bounded@example.test",
        }),
      ),
    );
    vi.stubGlobal("fetch", stripeFetch);

    const response = await call(adminToken, "/api/v1/donations/sync", {
      method: "POST",
      body: JSON.stringify({ pendingOnly: true }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { synced: number; results: unknown[] };
    expect(body.synced).toBe(50);
    expect(body.results).toHaveLength(50);
    expect(stripeFetch).toHaveBeenCalledTimes(50);
  });

  it("reports supplemental Stripe failures without falsely changing an unpaid donation", async () => {
    await insertDonation({ checkoutSessionId: "cs_sync_unpaid_failure", status: "pending", email: "" });
    const providerBodySentinel = "SECRET_PROVIDER_BODY admin-sync@example.test";
    const stripeFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(stripeCheckoutSession("cs_sync_unpaid_failure", "unpaid")))
      .mockResolvedValueOnce(new Response(providerBodySentinel, { status: 429 }));
    vi.stubGlobal("fetch", stripeFetch);

    const response = await call(adminToken, "/api/v1/donations/sync", {
      method: "POST",
      body: JSON.stringify({ sessionIds: ["cs_sync_unpaid_failure"] }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: Array<{ sessionId: string; outcome: string; error?: string }>;
    };
    expect(body.results).toEqual([
      {
        sessionId: "cs_sync_unpaid_failure",
        outcome: "error",
        error: "Failed to fetch payment details from Stripe",
      },
    ]);
    expect(JSON.stringify(body)).not.toContain(providerBodySentinel);
    const row = await env.DB.prepare("SELECT status FROM donations WHERE checkout_session_id = ?")
      .bind("cs_sync_unpaid_failure")
      .first<{ status: string }>();
    expect(row).toEqual({ status: "pending" });
  });

  it("keeps a paid Stripe session authoritative when supplemental details fail", async () => {
    await insertDonation({ checkoutSessionId: "cs_sync_paid_failure", status: "pending", email: "" });
    const stripeFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(stripeCheckoutSession("cs_sync_paid_failure", "paid")))
      .mockResolvedValueOnce(new Response("SECRET_PROVIDER_BODY", { status: 503 }));
    vi.stubGlobal("fetch", stripeFetch);

    const response = await call(adminToken, "/api/v1/donations/sync", {
      method: "POST",
      body: JSON.stringify({ sessionIds: ["cs_sync_paid_failure"] }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: Array<{ outcome: string }> };
    expect(body.results).toEqual([{ sessionId: "cs_sync_paid_failure", outcome: "completed" }]);
    const row = await env.DB.prepare("SELECT status, net_amount FROM donations WHERE checkout_session_id = ?")
      .bind("cs_sync_paid_failure")
      .first<{ status: string; net_amount: number | null }>();
    expect(row).toEqual({ status: "completed", net_amount: null });
  });

  it("reports a detail failure instead of claiming completed donation backfill succeeded", async () => {
    await insertDonation({ checkoutSessionId: "cs_sync_backfill_failure", status: "completed", email: "" });
    const stripeFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(stripeCheckoutSession("cs_sync_backfill_failure", "paid")))
      .mockResolvedValueOnce(new Response("SECRET_PROVIDER_BODY", { status: 503 }));
    vi.stubGlobal("fetch", stripeFetch);

    const response = await call(adminToken, "/api/v1/donations/sync", {
      method: "POST",
      body: JSON.stringify({ sessionIds: ["cs_sync_backfill_failure"] }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: Array<{ outcome: string; error?: string }> };
    expect(body.results).toEqual([
      {
        sessionId: "cs_sync_backfill_failure",
        outcome: "error",
        error: "Failed to fetch payment details from Stripe",
      },
    ]);
  });
});

describe("GET /api/v1/donations/promoters", () => {
  let adminToken: string;

  async function insertPromoter(code: string, clicks: number): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO donation_promoters (code, donation_id, checkout_session_id, name, clicks, created_at)
       VALUES (?, NULL, NULL, ?, ?, datetime('now'))`,
    )
      .bind(code, `Promoter ${code}`, clicks)
      .run();
  }

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminToken = await createAdminSession(env.DB, adminRow.id, "admin-donation-promoters-token");

    await insertPromoter("promoA1", 30);
    await insertPromoter("promoB2", 20);
    await insertPromoter("promoC3", 10);
  });

  it("lists promoters ordered by clicks descending with a page envelope", async () => {
    const response = await call(adminToken, "/api/v1/donations/promoters");
    expect(response.status).toBe(200);
    const body = donationPromotersListResponseSchema.parse(await response.json());
    expect(body.promoters.map((p) => p.code)).toEqual(["promoA1", "promoB2", "promoC3"]);
    expect(body.page).toEqual({ limit: 50, offset: 0, total: 3, hasMore: false });
    expect(body.summary).toEqual({
      promoterCount: 3,
      totalOwnGrossUsd: 0,
      totalAttributedGrossUsd: 0,
      totalClicks: 60,
      totalAttributedCompleted: 0,
    });
  });

  it("bounds results with limit/offset instead of returning every promoter unbounded", async () => {
    const response = await call(adminToken, "/api/v1/donations/promoters?q=promo&limit=1&offset=1");
    expect(response.status).toBe(200);
    const body = donationPromotersListResponseSchema.parse(await response.json());
    expect(body.promoters.map((p) => p.code)).toEqual(["promoB2"]);
    expect(body.page).toEqual({ limit: 1, offset: 1, total: 3, hasMore: true });
  });

  it("rejects an invalid limit", async () => {
    const response = await call(adminToken, "/api/v1/donations/promoters?limit=0");
    expect(response.status).toBe(400);
  });
});
