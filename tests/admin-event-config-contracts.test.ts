import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { decorateOpenApiSpec } from "../functions/_lib/openapi/mcp";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { insertUser } from "./helpers/membership";
import { apiErrorPayloadSchema, successResponseSchema } from "../assets/shared/schemas/api-common";
import { adminEventSyncResponseSchema } from "../assets/shared/schemas/route-contracts-admin-events";
import { eventSponsorTiersResponseSchema } from "../assets/shared/schemas/sponsorship-management";
import { openapi } from "../functions/router";
import type { DatabaseLike } from "../functions/_lib/types";

async function setupAdmin(): Promise<string> {
  await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
  return createAdminSession(env.DB, admin.id, `event-config-${crypto.randomUUID()}`);
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return callWithDatabase(token, path, env.DB, init);
}

async function callWithDatabase(
  token: string,
  path: string,
  db: DatabaseLike,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return app.fetch(
    new Request(`https://app.test${path}`, { ...init, headers }),
    { ...env, DB: db } as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function createEventStaff(permission: "events:read" | "events:write", eventId: string) {
  const userId = await insertUser(env.DB, `event-sponsor-tier-${permission}-${crypto.randomUUID()}@test.invalid`);
  const grantId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO permission_grants
       (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
     VALUES (?, ?, ?, 'event', ?, ?, datetime('now'))`,
  )
    .bind(grantId, userId, permission, eventId, userId)
    .run();
  return {
    grantId,
    token: await createAdminSession(env.DB, userId, `event-sponsor-tier-${crypto.randomUUID()}`),
  };
}

describe("admin event configuration OpenAPI boundaries", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("documents every event configuration route through its mounted OpenAPI router", () => {
    const spec = decorateOpenApiSpec(openapi.schema);
    expect(spec.paths["/api/v1/admin/events/sync-from-hugo"].post).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/settings"].patch).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/terms"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/days"].get).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/days"].put).toBeUndefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/sponsor-tiers"].get).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/sponsor-tiers"].put).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/sponsor-tiers"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/permissions/{permId}"].delete).toBeDefined();
  });

  it("returns the canonical error envelope for malformed and invalid configuration payloads", async () => {
    const token = await setupAdmin();

    const malformed = await call(token, "/api/v1/admin/events/sync-from-hugo", {
      method: "POST",
      body: "{not-json",
    });
    expect(malformed.status).toBe(400);
    expect(apiErrorPayloadSchema.parse(await malformed.json()).error.code).toBe("INVALID_JSON");

    const invalidTiers = await call(token, "/api/v1/events/pqc-2026/sponsor-tiers", {
      method: "PUT",
      body: JSON.stringify({
        tiers: [
          { tierName: "Leader", hasAttendeeDataAccess: true },
          { tierName: "leader", hasAttendeeDataAccess: false },
        ],
      }),
    });
    expect(invalidTiers.status).toBe(400);
    expect(apiErrorPayloadSchema.parse(await invalidTiers.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("parses successful response bodies for sync, sponsor tiers, and permission revocation", async () => {
    const token = await setupAdmin();

    const sync = await call(token, "/api/v1/admin/events/sync-from-hugo", {
      method: "POST",
      body: JSON.stringify({
        event: { slug: "contract-event", name: "Contract Event", timezone: "UTC" },
      }),
    });
    expect(sync.status).toBe(200);
    expect(adminEventSyncResponseSchema.parse(await sync.json()).event.slug).toBe("contract-event");

    const tiersPut = await call(token, "/api/v1/events/pqc-2026/sponsor-tiers", {
      method: "PUT",
      body: JSON.stringify({ tiers: [{ tierName: "Leader", hasAttendeeDataAccess: true }] }),
    });
    expect(tiersPut.status).toBe(200);
    expect(eventSponsorTiersResponseSchema.parse(await tiersPut.json()).tiers).toEqual([
      { tierName: "Leader", hasAttendeeDataAccess: true },
    ]);

    const permission = await call(token, "/api/v1/admin/events/pqc-2026/permissions", {
      method: "POST",
      body: JSON.stringify({ userEmail: "contract-permission@example.test", permission: "organizer" }),
    });
    expect(permission.status).toBe(201);
    const permissionBody = (await permission.json()) as { permission: { id: string } };
    const permissionId = permissionBody.permission.id;

    const revoked = await call(token, `/api/v1/admin/events/pqc-2026/permissions/${permissionId}`, {
      method: "DELETE",
    });
    expect(revoked.status).toBe(200);
    expect(successResponseSchema.parse(await revoked.json())).toEqual({ success: true });
  });

  it("uses exact event-scoped read/write permissions, rejects API keys, and leaves the legacy route unmounted", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const reader = await createEventStaff("events:read", eventId);
    const writer = await createEventStaff("events:write", eventId);
    const body = JSON.stringify({ tiers: [{ tierName: "Leader", hasAttendeeDataAccess: true }] });

    expect((await call(reader.token, "/api/v1/events/pqc-2026/sponsor-tiers")).status).toBe(200);
    expect((await call(reader.token, "/api/v1/events/pqc-2026/sponsor-tiers", { method: "PUT", body })).status).toBe(
      403,
    );
    expect((await call(writer.token, "/api/v1/events/pqc-2026/sponsor-tiers")).status).toBe(403);
    expect((await call(writer.token, "/api/v1/events/pqc-2026/sponsor-tiers", { method: "PUT", body })).status).toBe(
      200,
    );

    const apiKey = env.ADMIN_API_KEY ?? "test-admin-key";
    expect((await call(apiKey, "/api/v1/events/pqc-2026/sponsor-tiers")).status).toBe(403);
    expect((await call(apiKey, "/api/v1/events/pqc-2026/sponsor-tiers", { method: "PUT", body })).status).toBe(403);

    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    const adminToken = await createAdminSession(env.DB, admin.id, `legacy-event-tier-${crypto.randomUUID()}`);
    expect((await call(adminToken, "/api/v1/admin/events/pqc-2026/sponsor-tiers")).status).toBe(404);
  });

  it("rolls back event sponsor tiers and audit when the scoped write grant is revoked before commit", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const writer = await createEventStaff("events:write", eventId);
    const originalBody = JSON.stringify({ tiers: [{ tierName: "Leader", hasAttendeeDataAccess: true }] });
    expect(
      (
        await call(writer.token, "/api/v1/events/pqc-2026/sponsor-tiers", {
          method: "PUT",
          body: originalBody,
        })
      ).status,
    ).toBe(200);
    const auditCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'event_sponsor_tiers_updated' AND entity_id = ?",
    )
      .bind(eventId)
      .first<number>("count");

    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?")
        .bind(writer.grantId)
        .run(),
    );
    const response = await callWithDatabase(writer.token, "/api/v1/events/pqc-2026/sponsor-tiers", racingDb, {
      method: "PUT",
      body: JSON.stringify({ tiers: [{ tierName: "Partner", hasAttendeeDataAccess: false }] }),
    });
    expect(response.status).toBe(409);
    expect(apiErrorPayloadSchema.parse(await response.json()).error.code).toBe(
      "EVENT_SPONSOR_TIER_AUTHORIZATION_CHANGED",
    );
    expect(
      await queryAll<{ tier_name: string; has_attendee_data_access: number }>(
        env.DB,
        `SELECT tier_name, has_attendee_data_access
           FROM event_sponsor_attendee_tiers
          WHERE event_id = ?`,
        [eventId],
      ),
    ).toEqual([{ tier_name: "Leader", has_attendee_data_access: 1 }]);
    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'event_sponsor_tiers_updated' AND entity_id = ?",
      )
        .bind(eventId)
        .first<number>("count"),
    ).resolves.toBe(auditCount);
  });
});
