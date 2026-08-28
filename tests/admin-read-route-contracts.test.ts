import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app, { openapi } from "../functions/router";
import { decorateOpenApiSpec } from "../functions/_lib/openapi/mcp";
import { adminEventDetailResponseSchema } from "../assets/shared/schemas/admin-events";
import { adminEventStatsResponseSchema } from "../assets/shared/schemas/admin-analytics";
import { systemAnalyticsSummaryResponseSchema } from "../assets/shared/schemas/system-analytics";
import { donationDetailResponseSchema } from "../assets/shared/schemas/donation-management";
import { emailTemplateExistsResponseSchema } from "../assets/shared/schemas/email-templates";
import { userDetailResponseSchema } from "../assets/shared/schemas/user-management";
import { apiErrorPayloadSchema } from "../assets/shared/schemas/api-common";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { createProposal } from "../functions/_lib/services/proposals";

async function setupAdmin(): Promise<{ token: string; userId: string }> {
  await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
  return { token: await createAdminSession(env.DB, admin.id, `admin-read-${crypto.randomUUID()}`), userId: admin.id };
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return app.fetch(
    new Request(`https://app.test${path}`, { ...init, headers }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

describe("admin read route OpenAPI contracts", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("documents all converted admin reads", () => {
    const paths = decorateOpenApiSpec(openapi.schema).paths;
    expect(paths["/api/v1/donations/{id}"].get).toBeDefined();
    expect(paths["/api/v1/admin/donations/{id}"]).toBeUndefined();
    expect(paths["/api/v1/system/email-templates/{key}/exists"].get).toBeDefined();
    expect(paths["/api/v1/admin/email-templates/{key}/exists"]).toBeUndefined();
    expect(paths["/api/v1/system/analytics/summary"].get).toBeDefined();
    expect(paths["/api/v1/admin/stats"]).toBeUndefined();
    expect(paths["/api/v1/admin/votes"]).toBeUndefined();
    expect(paths["/api/v1/admin/votes/{id}"]).toBeUndefined();
    expect(paths["/api/v1/admin/votes/{id}/visibility"]).toBeUndefined();
    expect(paths["/api/v1/admin/votes/{id}/ballots"]).toBeUndefined();
    expect(paths["/api/v1/admin/events/{eventSlug}"].get).toBeDefined();
    expect(paths["/api/v1/admin/events/{eventSlug}/stats"].get).toBeDefined();
    expect(paths["/api/v1/users"].get).toBeDefined();
    expect(paths["/api/v1/users/{userId}"].get).toBeDefined();
    expect(paths["/api/v1/members/capacities"].get).toBeDefined();
    expect(paths["/api/v1/admin/users"]).toBeUndefined();
    expect(paths["/api/v1/admin/users/{userId}"]).toBeUndefined();
    expect(paths["/api/v1/admin/members"]).toBeUndefined();
  });

  it("returns not found for the retired platform statistics endpoint", async () => {
    const { token } = await setupAdmin();
    const response = await call(token, "/api/v1/admin/stats");
    expect(response.status).toBe(404);
  });

  it("returns not found for retired admin vote endpoints", async () => {
    const { token } = await setupAdmin();
    for (const [path, method] of [
      ["/api/v1/admin/votes", "GET"],
      ["/api/v1/admin/votes", "POST"],
      ["/api/v1/admin/votes/legacy-vote", "PATCH"],
      ["/api/v1/admin/votes/legacy-vote/visibility", "PATCH"],
      ["/api/v1/admin/votes/legacy-vote/ballots", "GET"],
    ] as const) {
      const response = await call(token, path, { method });
      expect(response.status).toBe(404);
    }
  });

  it("returns not found for retired admin user and membership endpoints", async () => {
    const { token } = await setupAdmin();
    for (const [path, method] of [
      ["/api/v1/admin/users", "GET"],
      ["/api/v1/admin/users/00000000-0000-4000-8000-000000000000", "GET"],
      ["/api/v1/admin/members", "GET"],
      ["/api/v1/admin/members/00000000-0000-4000-8000-000000000000", "DELETE"],
    ] as const) {
      const response = await call(token, path, { method });
      expect(response.status).toBe(404);
    }
  });

  it("rejects malformed identifiers with the canonical error envelope", async () => {
    const { token } = await setupAdmin();

    const donation = await call(token, "/api/v1/donations/not-an-id");
    expect(donation.status).toBe(400);
    expect(apiErrorPayloadSchema.parse(await donation.json()).error.code).toBe("VALIDATION_ERROR");

    const user = await call(token, "/api/v1/users/not-an-id");
    expect(user.status).toBe(400);
    expect(apiErrorPayloadSchema.parse(await user.json()).error.code).toBe("VALIDATION_ERROR");

    const key = await call(token, `/api/v1/system/email-templates/${"a".repeat(201)}/exists`);
    expect(key.status).toBe(400);
    expect(apiErrorPayloadSchema.parse(await key.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("parses successful responses for each converted admin read", async () => {
    const { token, userId } = await setupAdmin();
    const donationId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO donations (id, checkout_session_id, status, name, email, currency, gross_amount, completed_at, created_at)
       VALUES (?, ?, 'completed', 'Contract Donor', 'donor@example.test', 'usd', 2500, datetime('now'), datetime('now'))`,
    )
      .bind(donationId, `cs_contract_${crypto.randomUUID()}`)
      .run();

    const donation = await call(token, `/api/v1/donations/${donationId}`);
    expect(donation.status).toBe(200);
    expect(donationDetailResponseSchema.parse(await donation.json()).donation.id).toBe(donationId);

    const exists = await call(token, "/api/v1/system/email-templates/unknown_template/exists");
    expect(exists.status).toBe(200);
    expect(emailTemplateExistsResponseSchema.parse(await exists.json()).exists).toBe(false);

    const stats = await call(token, "/api/v1/system/analytics/summary");
    expect(stats.status).toBe(200);
    systemAnalyticsSummaryResponseSchema.parse(await stats.json());

    const detail = await call(token, "/api/v1/admin/events/pqc-2026");
    expect(detail.status).toBe(200);
    expect(adminEventDetailResponseSchema.parse(await detail.json()).event.slug).toBe("pqc-2026");

    const eventStats = await call(token, "/api/v1/admin/events/pqc-2026/stats");
    expect(eventStats.status).toBe(200);
    expect(adminEventStatsResponseSchema.parse(await eventStats.json()).event.slug).toBe("pqc-2026");

    const user = await call(token, `/api/v1/users/${userId}`);
    expect(user.status).toBe(200);
    expect(userDetailResponseSchema.parse(await user.json()).user.id).toBe(userId);
  });

  it("does not expose proposal statistics through generic event-read access", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const readerId = await insertUser(env.DB, `event-stats-reader-${crypto.randomUUID()}@example.test`);
    const authorId = await insertUser(env.DB, `event-stats-author-${crypto.randomUUID()}@example.test`);
    await createProposal(env.DB, {
      eventId,
      proposerUserId: authorId,
      proposalType: "talk",
      title: "Protected proposal statistics",
      abstract: "A sufficiently detailed proposal abstract used to verify event statistics authorization.",
    });
    await env.DB.prepare(
      `INSERT INTO permission_grants
         (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'events:read', 'event', ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), readerId, eventId, readerId)
      .run();
    const token = await createAdminSession(env.DB, readerId, `event-stats-${crypto.randomUUID()}`);

    const eventOnlyResponse = await call(token, "/api/v1/admin/events/pqc-2026/stats");
    expect(eventOnlyResponse.status).toBe(200);
    expect(adminEventStatsResponseSchema.parse(await eventOnlyResponse.json()).proposals).toBeNull();

    await env.DB.prepare(
      `INSERT INTO permission_grants
         (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'proposals:read', 'event', ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), readerId, eventId, readerId)
      .run();
    const proposalResponse = await call(token, "/api/v1/admin/events/pqc-2026/stats");
    expect(proposalResponse.status).toBe(200);
    expect(adminEventStatsResponseSchema.parse(await proposalResponse.json()).proposals).toMatchObject({
      byStatus: { submitted: 1 },
      total: 1,
    });
  });
});
