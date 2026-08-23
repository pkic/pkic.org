import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app, { openapi } from "../functions/router";
import { decorateOpenApiSpec } from "../functions/_lib/openapi/mcp";
import { adminEventDetailResponseSchema } from "../assets/shared/schemas/admin-events";
import { adminEventStatsResponseSchema, adminStatsResponseSchema } from "../assets/shared/schemas/admin-analytics";
import { donationDetailResponseSchema } from "../assets/shared/schemas/admin-donations";
import { adminEmailTemplateExistsResponseSchema } from "../assets/shared/schemas/admin-email-templates";
import { adminUserDetailResponseSchema } from "../assets/shared/schemas/admin-users";
import { apiErrorPayloadSchema } from "../assets/shared/schemas/api-common";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

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
    expect(paths["/api/v1/admin/donations/{id}"].get).toBeDefined();
    expect(paths["/api/v1/admin/email-templates/{key}/exists"].get).toBeDefined();
    expect(paths["/api/v1/admin/stats"].get).toBeDefined();
    expect(paths["/api/v1/admin/events/{eventSlug}"].get).toBeDefined();
    expect(paths["/api/v1/admin/events/{eventSlug}/stats"].get).toBeDefined();
    expect(paths["/api/v1/admin/users/{userId}"].get).toBeDefined();
  });

  it("rejects malformed identifiers with the canonical error envelope", async () => {
    const { token } = await setupAdmin();

    const donation = await call(token, "/api/v1/admin/donations/not-an-id");
    expect(donation.status).toBe(400);
    expect(apiErrorPayloadSchema.parse(await donation.json()).error.code).toBe("VALIDATION_ERROR");

    const user = await call(token, "/api/v1/admin/users/not-an-id");
    expect(user.status).toBe(400);
    expect(apiErrorPayloadSchema.parse(await user.json()).error.code).toBe("VALIDATION_ERROR");

    const key = await call(token, `/api/v1/admin/email-templates/${"a".repeat(201)}/exists`);
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

    const donation = await call(token, `/api/v1/admin/donations/${donationId}`);
    expect(donation.status).toBe(200);
    expect(donationDetailResponseSchema.parse(await donation.json()).donation.id).toBe(donationId);

    const exists = await call(token, "/api/v1/admin/email-templates/unknown_template/exists");
    expect(exists.status).toBe(200);
    expect(adminEmailTemplateExistsResponseSchema.parse(await exists.json()).exists).toBe(false);

    const stats = await call(token, "/api/v1/admin/stats");
    expect(stats.status).toBe(200);
    adminStatsResponseSchema.parse(await stats.json());

    const detail = await call(token, "/api/v1/admin/events/pqc-2026");
    expect(detail.status).toBe(200);
    expect(adminEventDetailResponseSchema.parse(await detail.json()).event.slug).toBe("pqc-2026");

    const eventStats = await call(token, "/api/v1/admin/events/pqc-2026/stats");
    expect(eventStats.status).toBe(200);
    expect(adminEventStatsResponseSchema.parse(await eventStats.json()).event.slug).toBe("pqc-2026");

    const user = await call(token, `/api/v1/admin/users/${userId}`);
    expect(user.status).toBe(200);
    expect(adminUserDetailResponseSchema.parse(await user.json()).user.id).toBe(userId);
  });
});
