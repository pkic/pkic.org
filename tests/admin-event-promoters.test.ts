import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { eventPromotersListResponseSchema } from "../assets/shared/schemas/admin-event-promoters";

let adminToken: string;
let eventId: string;

async function call(path: string): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, { headers: { authorization: `Bearer ${adminToken}` } }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function insertPromoter(email: string, accepted: number, clicks: number): Promise<string> {
  const userId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Promoter', datetime('now'), datetime('now'))`,
  )
    .bind(userId, email, email, email.split("@")[0])
    .run();
  for (let index = 0; index < accepted + 1; index += 1) {
    await env.DB.prepare(
      `INSERT INTO invites
         (id, event_id, inviter_user_id, invitee_email, invite_type, link_secret, status, source_type, created_at)
       VALUES (?, ?, ?, ?, 'attendee', ?, ?, 'direct', datetime('now'))`,
    )
      .bind(
        crypto.randomUUID(),
        eventId,
        userId,
        `invite-${index}-${email}`,
        crypto.randomUUID(),
        index < accepted ? "accepted" : "sent",
      )
      .run();
  }
  await env.DB.prepare(
    `INSERT INTO referral_codes
       (code, event_id, owner_type, owner_id, created_by_user_id, clicks, conversions, created_at)
     VALUES (?, ?, 'user', ?, ?, ?, ?, datetime('now'))`,
  )
    .bind(`code${userId.slice(0, 6)}`, eventId, userId, userId, clicks, Math.min(clicks, 1))
    .run();
  return userId;
}

describe("GET /api/v1/admin/events/:eventSlug/promoters", () => {
  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(env.DB));
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0];
    adminToken = await createAdminSession(env.DB, admin.id, "event-promoters-token");
  });

  it("ranks, summarizes, and paginates promoters in D1", async () => {
    await insertPromoter("first@example.test", 2, 5);
    await insertPromoter("second@example.test", 1, 1);

    const response = await call("/api/v1/admin/events/pqc-2026/promoters?view=promoters&sort=-impact&limit=1");
    expect(response.status).toBe(200);
    const body = eventPromotersListResponseSchema.parse(await response.json());
    expect(body.promoters.map(({ email }) => email)).toEqual(["first@example.test"]);
    expect(body.page).toEqual({ limit: 1, offset: 0, total: 2, hasMore: true });
    expect(body.summary).toMatchObject({
      activePromoters: 2,
      promotersWithRegistrations: 2,
      totalInvitesSent: 5,
      totalInvitesAccepted: 3,
      totalReferralClicks: 6,
      totalReferralConversions: 2,
      referralCodeCount: 2,
    });

    const secondPage = await call(
      "/api/v1/admin/events/pqc-2026/promoters?view=promoters&q=example&sort=-impact&limit=1&offset=1",
    );
    expect(secondPage.status).toBe(200);
    const secondPageBody = eventPromotersListResponseSchema.parse(await secondPage.json());
    expect(secondPageBody.promoters.map(({ email }) => email)).toEqual(["second@example.test"]);
    expect(secondPageBody.page).toEqual({ limit: 1, offset: 1, total: 2, hasMore: false });
  });

  it("returns a separate bounded referral-code view", async () => {
    await insertPromoter("owner@example.test", 0, 3);
    await insertPromoter("second-owner@example.test", 0, 1);
    const response = await call(
      "/api/v1/admin/events/pqc-2026/promoters?view=codes&q=example&limit=1&offset=1&sort=-clicks",
    );
    expect(response.status).toBe(200);
    const body = eventPromotersListResponseSchema.parse(await response.json());
    expect(body.promoters).toEqual([]);
    expect(body.referralCodes).toHaveLength(1);
    expect(body.referralCodes[0].owner_email).toBe("second-owner@example.test");
    expect(body.page).toEqual({ limit: 1, offset: 1, total: 2, hasMore: false });
  });

  it("rejects sort keys that belong to the other view", async () => {
    expect((await call("/api/v1/admin/events/pqc-2026/promoters?view=promoters&sort=conversions")).status).toBe(400);
    expect((await call("/api/v1/admin/events/pqc-2026/promoters?view=codes&sort=impact")).status).toBe(400);
    expect((await call("/api/v1/admin/events/pqc-2026/promoters?sort=code")).status).toBe(400);
  });
});
