/**
 * GET /api/v1/admin/events/:eventSlug/invites (P6M-P2-05).
 *
 * Was manually parsing new URL() with no Chanfana schema, and computed a
 * limit+1-and-slice hasMore *in addition to* a redundant separate COUNT(*)
 * (P6M-CC-03). Now wraps the route in openApiRoute with a validated
 * data.query, and the page query + real COUNT(*) share the same WHERE
 * filters and run concurrently.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";

async function call(token: string, path: string): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, { headers: { authorization: `Bearer ${token}` } }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function insertInvite(
  eventId: string,
  opts: { email: string; status?: string; createdAt: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO invites
       (id, event_id, invitee_email, invite_type, link_secret, status, source_type, created_at)
     VALUES (?, ?, ?, 'attendee', ?, ?, 'direct', ?)`,
  )
    .bind(crypto.randomUUID(), eventId, opts.email, crypto.randomUUID(), opts.status ?? "sent", opts.createdAt)
    .run();
}

describe("GET /api/v1/admin/events/:eventSlug/invites (P6M-P2-05)", () => {
  let adminToken: string;
  let eventId: string;

  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(env.DB));
    const adminRow = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    adminToken = await createAdminSession(env.DB, adminRow.id, "admin-invites-list-token");

    await insertInvite(eventId, { email: "a@invite.test", createdAt: "2026-01-01T00:00:00.000Z" });
    await insertInvite(eventId, { email: "b@invite.test", createdAt: "2026-01-02T00:00:00.000Z" });
    await insertInvite(eventId, { email: "c@invite.test", status: "accepted", createdAt: "2026-01-03T00:00:00.000Z" });
  });

  it("bounds results with limit/offset via data.query and returns a real page envelope", async () => {
    const response = await call(
      adminToken,
      `/api/v1/admin/events/pqc-2026/invites?limit=2&offset=0&sort=${encodeURIComponent("i.created_at")}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      invites: Array<{ invitee_email: string }>;
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(body.invites).toHaveLength(2);
    expect(body.page).toEqual({ limit: 2, offset: 0, total: 3, hasMore: true });
  });

  it("filters by status", async () => {
    const response = await call(adminToken, "/api/v1/admin/events/pqc-2026/invites?status=accepted");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { invites: Array<{ invitee_email: string }>; page: { total: number } };
    expect(body.invites.map((i) => i.invitee_email)).toEqual(["c@invite.test"]);
    expect(body.page.total).toBe(1);
  });

  it("rejects an invalid limit", async () => {
    const response = await call(adminToken, "/api/v1/admin/events/pqc-2026/invites?limit=0");
    expect(response.status).toBe(400);
  });
});
