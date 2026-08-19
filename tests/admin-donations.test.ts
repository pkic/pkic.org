/**
 * admin-donations.test.ts
 *
 * Covers GET /api/v1/admin/donations (P6M-P2-02) — migrated from an
 * unbounded/manually-parsed handler onto the shared Chanfana query schema
 * + openApiRoute pattern every other admin list endpoint uses (see
 * functions/api/v1/admin/organizations/index.ts).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";

function request(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(request(token, path, init), env as any, { passThroughOnException: () => {}, waitUntil: () => {} } as any);
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

describe("GET /api/v1/admin/donations (P6M-P2-02)", () => {
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
    const response = await call(adminToken, "/api/v1/admin/donations");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      donations: Array<{ checkout_session_id: string; status: string }>;
      summary: Record<string, number>;
      limit: number;
      offset: number;
      total: number;
    };
    expect(body.donations.map((d) => d.checkout_session_id)).toEqual(["cs_3", "cs_2", "cs_1"]);
    expect(body.total).toBe(3);
    expect(body.limit).toBe(100);
    expect(body.offset).toBe(0);
    expect(body.summary).toEqual({ completed: 1, pending: 1, expired: 1 });
  });

  it("filters by status", async () => {
    const response = await call(adminToken, "/api/v1/admin/donations?status=pending");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      donations: Array<{ checkout_session_id: string }>;
      summary: Record<string, number>;
      total: number;
    };
    expect(body.donations.map((d) => d.checkout_session_id)).toEqual(["cs_2"]);
    expect(body.total).toBe(1);
    // summary is unaffected by the status filter — still every status's count.
    expect(body.summary).toEqual({ completed: 1, pending: 1, expired: 1 });
  });

  it("rejects an unknown status value instead of silently matching nothing", async () => {
    const response = await call(adminToken, "/api/v1/admin/donations?status=bogus");
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("sorts by an allowlisted column ascending/descending", async () => {
    const asc = await call(adminToken, "/api/v1/admin/donations?sort=gross_amount");
    const ascBody = (await asc.json()) as { donations: Array<{ checkout_session_id: string }> };
    expect(ascBody.donations.map((d) => d.checkout_session_id)).toEqual(["cs_1", "cs_3", "cs_2"]);

    const desc = await call(adminToken, "/api/v1/admin/donations?sort=-gross_amount");
    const descBody = (await desc.json()) as { donations: Array<{ checkout_session_id: string }> };
    expect(descBody.donations.map((d) => d.checkout_session_id)).toEqual(["cs_2", "cs_3", "cs_1"]);
  });

  it("rejects an unknown/unsafe sort column with a 400 instead of silently falling back", async () => {
    const response = await call(
      adminToken,
      `/api/v1/admin/donations?sort=${encodeURIComponent("id; DROP TABLE donations; --")}`,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");

    const stillExists = await queryAll(env.DB, "SELECT id FROM donations");
    expect(stillExists.length).toBe(3);
  });

  it("bounds results with limit/offset", async () => {
    const response = await call(adminToken, "/api/v1/admin/donations?limit=1&offset=1&sort=created_at");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      donations: Array<{ checkout_session_id: string }>;
      limit: number;
      offset: number;
      total: number;
    };
    expect(body.donations.map((d) => d.checkout_session_id)).toEqual(["cs_2"]);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(1);
    expect(body.total).toBe(3);
  });

  it("rejects a limit above the historical 500 cap", async () => {
    const response = await call(adminToken, "/api/v1/admin/donations?limit=501");
    expect(response.status).toBe(400);
  });
});
