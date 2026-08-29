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
import { eventImportResponseSchema } from "../assets/shared/schemas/event-imports";
import { eventSponsorTiersResponseSchema } from "../assets/shared/schemas/sponsorship-management";
import { eventManagementDetailResponseSchema } from "../assets/shared/schemas/event-management";
import {
  eventDaysManagementReplaceResponseSchema,
  eventDaysManagementResponseSchema,
} from "../assets/shared/schemas/event-configuration";
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

async function eventRevision(): Promise<string> {
  const [row] = await queryAll<{ updated_at: string }>(env.DB, "SELECT updated_at FROM events WHERE slug = ?", [
    "pqc-2026",
  ]);
  return row.updated_at;
}

describe("admin event configuration OpenAPI boundaries", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("documents every event configuration route through its mounted OpenAPI router", () => {
    const spec = decorateOpenApiSpec(openapi.schema);
    expect(spec.paths["/api/v1/events/imports"].post).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/sync-from-hugo"]).toBeUndefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/settings"].patch).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/settings"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/terms"]).toBeUndefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/days"].get).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/days"].put).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/days"]).toBeUndefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/sponsors/tiers"].get).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/sponsors/tiers"].put).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/sponsor-tiers"]).toBeUndefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/speakers/invitations"].post).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/speaker-invites"]).toBeUndefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/sponsor-tiers"]).toBeUndefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/roles"].get).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/roles"].post).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/roles/{roleAssignmentId}"].delete).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/permissions"]).toBeUndefined();
  });

  it("returns the canonical error envelope for malformed and invalid configuration payloads", async () => {
    const token = await setupAdmin();

    const malformed = await call(token, "/api/v1/events/imports", {
      method: "POST",
      body: "{not-json",
    });
    expect(malformed.status).toBe(400);
    expect(apiErrorPayloadSchema.parse(await malformed.json()).error.code).toBe("INVALID_JSON");

    const invalidTiers = await call(token, "/api/v1/events/pqc-2026/sponsors/tiers", {
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

  it("parses successful response bodies for imports, sponsor tiers, and event-role revocation", async () => {
    const token = await setupAdmin();

    const imported = await call(token, "/api/v1/events/imports", {
      method: "POST",
      body: JSON.stringify({
        source: "hugo",
        event: { slug: "contract-event", name: "Contract Event", timezone: "UTC" },
      }),
    });
    expect(imported.status).toBe(200);
    const importedPayload = eventImportResponseSchema.parse(await imported.json());
    expect(importedPayload.event.slug).toBe("contract-event");
    expect(importedPayload.created).toBe(true);
    expect(importedPayload.source).toBe("hugo");

    const tiersPut = await call(token, "/api/v1/events/pqc-2026/sponsors/tiers", {
      method: "PUT",
      body: JSON.stringify({ tiers: [{ tierName: "Leader", hasAttendeeDataAccess: true }] }),
    });
    expect(tiersPut.status).toBe(200);
    expect(eventSponsorTiersResponseSchema.parse(await tiersPut.json()).tiers).toEqual([
      { tierName: "Leader", hasAttendeeDataAccess: true },
    ]);

    const role = await call(token, "/api/v1/events/pqc-2026/roles", {
      method: "POST",
      body: JSON.stringify({ userEmail: "contract-role@example.test", role: "organizer" }),
    });
    expect(role.status).toBe(201);
    const roleBody = (await role.json()) as { role: { id: string } };

    const revoked = await call(token, `/api/v1/events/pqc-2026/roles/${roleBody.role.id}`, {
      method: "DELETE",
    });
    expect(revoked.status).toBe(200);
    expect(successResponseSchema.parse(await revoked.json())).toEqual({ success: true });

    const retired = await call(token, "/api/v1/admin/events/pqc-2026/permissions");
    expect(retired.status).toBe(404);
  });

  it("uses exact event-scoped read/write permissions, rejects API keys, and leaves the legacy route unmounted", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const reader = await createEventStaff("events:read", eventId);
    const writer = await createEventStaff("events:write", eventId);
    const body = JSON.stringify({ tiers: [{ tierName: "Leader", hasAttendeeDataAccess: true }] });

    expect((await call(reader.token, "/api/v1/events/pqc-2026/sponsors/tiers")).status).toBe(200);
    expect((await call(reader.token, "/api/v1/events/pqc-2026/sponsors/tiers", { method: "PUT", body })).status).toBe(
      403,
    );
    expect((await call(writer.token, "/api/v1/events/pqc-2026/sponsors/tiers")).status).toBe(403);
    expect((await call(writer.token, "/api/v1/events/pqc-2026/sponsors/tiers", { method: "PUT", body })).status).toBe(
      200,
    );

    const apiKey = env.ADMIN_API_KEY ?? "test-admin-key";
    expect((await call(apiKey, "/api/v1/events/pqc-2026/sponsors/tiers")).status).toBe(403);
    expect((await call(apiKey, "/api/v1/events/pqc-2026/sponsors/tiers", { method: "PUT", body })).status).toBe(403);

    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    const adminToken = await createAdminSession(env.DB, admin.id, `legacy-event-tier-${crypto.randomUUID()}`);
    expect((await call(adminToken, "/api/v1/events/pqc-2026/sponsor-tiers")).status).toBe(404);
    expect(
      (
        await call(adminToken, "/api/v1/events/pqc-2026/speaker-invites", {
          method: "POST",
          body: JSON.stringify({ email: "speaker@example.test" }),
        })
      ).status,
    ).toBe(404);
    expect((await call(adminToken, "/api/v1/admin/events/pqc-2026/sponsor-tiers")).status).toBe(404);
  });

  it("scopes event detail, settings, and days to the exact event permission", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const otherEventId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO events (id, slug, name, timezone, visibility, created_at, updated_at)
       VALUES (?, ?, 'Other event', 'UTC', 'invitation_only', datetime('now'), datetime('now'))`,
    )
      .bind(otherEventId, `other-event-${crypto.randomUUID()}`)
      .run();
    const reader = await createEventStaff("events:read", eventId);
    const writer = await createEventStaff("events:write", eventId);
    const outsider = await createEventStaff("events:read", otherEventId);

    const detail = await call(reader.token, "/api/v1/events/pqc-2026");
    expect(detail.status).toBe(200);
    expect(eventManagementDetailResponseSchema.parse(await detail.json()).event.capabilities).toEqual(["read"]);
    expect((await call(reader.token, "/api/v1/events/pqc-2026/days")).status).toBe(200);
    expect(
      (
        await call(reader.token, "/api/v1/events/pqc-2026/settings", {
          method: "PATCH",
          body: JSON.stringify({ expectedUpdatedAt: await eventRevision(), name: "Reader mutation" }),
        })
      ).status,
    ).toBe(403);

    expect((await call(writer.token, "/api/v1/events/pqc-2026")).status).toBe(404);
    expect((await call(writer.token, "/api/v1/events/pqc-2026/days")).status).toBe(403);
    const update = await call(writer.token, "/api/v1/events/pqc-2026/settings", {
      method: "PATCH",
      body: JSON.stringify({ expectedUpdatedAt: await eventRevision(), name: "Writer mutation" }),
    });
    expect(update.status).toBe(200);
    expect(eventManagementDetailResponseSchema.parse(await update.json()).event.name).toBe("Writer mutation");

    expect((await call(outsider.token, "/api/v1/events/pqc-2026")).status).toBe(404);
    const apiKey = env.ADMIN_API_KEY ?? "test-admin-key";
    expect((await call(apiKey, "/api/v1/events/pqc-2026")).status).toBe(401);
    expect(
      (
        await call(apiKey, "/api/v1/events/pqc-2026/settings", {
          method: "PATCH",
          body: JSON.stringify({ expectedUpdatedAt: await eventRevision(), name: "Service mutation" }),
        })
      ).status,
    ).toBe(403);
  });

  it("rolls back settings when write permission or event ownership changes before commit", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const writer = await createEventStaff("events:write", eventId);
    const originalRevision = await eventRevision();
    const permissionRace = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?")
        .bind(writer.grantId)
        .run(),
    );
    const denied = await callWithDatabase(writer.token, "/api/v1/events/pqc-2026/settings", permissionRace, {
      method: "PATCH",
      body: JSON.stringify({ expectedUpdatedAt: originalRevision, name: "Must roll back" }),
    });
    expect(denied.status).toBe(409);
    expect(apiErrorPayloadSchema.parse(await denied.json()).error.code).toBe("EVENT_CONFIGURATION_CONTEXT_CHANGED");
    expect(await eventRevision()).toBe(originalRevision);
    expect(await env.DB.prepare("SELECT name FROM events WHERE id = ?").bind(eventId).first<string>("name")).toBe(
      "PQC Conference 2026",
    );

    const ownerWriter = await createEventStaff("events:write", eventId);
    const ownerRace = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE events SET owner_group_id = ?, source_mode = 'portal' WHERE id = ?")
        .bind("20000000-0000-4000-8000-000000000001", eventId)
        .run(),
    );
    const moved = await callWithDatabase(ownerWriter.token, "/api/v1/events/pqc-2026/settings", ownerRace, {
      method: "PATCH",
      body: JSON.stringify({ expectedUpdatedAt: originalRevision, name: "Must also roll back" }),
    });
    expect(moved.status).toBe(409);
    expect(apiErrorPayloadSchema.parse(await moved.json()).error.code).toBe("EVENT_CONFIGURATION_CONTEXT_CHANGED");
    expect(await env.DB.prepare("SELECT name FROM events WHERE id = ?").bind(eventId).first<string>("name")).toBe(
      "PQC Conference 2026",
    );
  });

  it("replaces days atomically and rejects stale revisions", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const writer = await createEventStaff("events:write", eventId);
    const reader = await createEventStaff("events:read", eventId);
    const firstRevision = await eventRevision();
    const first = await call(writer.token, "/api/v1/events/pqc-2026/days", {
      method: "PUT",
      body: JSON.stringify({
        expectedUpdatedAt: firstRevision,
        configuration: {
          days: [
            {
              date: "2026-12-01",
              label: "Conference day",
              startTime: "09:00",
              endTime: "17:00",
              attendanceOptions: [{ value: "in_person", label: "In person", capacity: 100 }],
            },
          ],
        },
      }),
    });
    expect(first.status).toBe(200);
    const firstPayload = eventDaysManagementReplaceResponseSchema.parse(await first.json());
    expect(firstPayload.eventUpdatedAt).not.toBe(firstRevision);
    const listed = await call(reader.token, "/api/v1/events/pqc-2026/days");
    expect(listed.status).toBe(200);
    expect(eventDaysManagementResponseSchema.parse(await listed.json()).days).toEqual([
      expect.objectContaining({ date: "2026-12-01", label: "Conference day", attendanceCounts: {} }),
    ]);

    const stale = await call(writer.token, "/api/v1/events/pqc-2026/days", {
      method: "PUT",
      body: JSON.stringify({ expectedUpdatedAt: firstRevision, configuration: { days: [] } }),
    });
    expect(stale.status).toBe(409);
    expect(apiErrorPayloadSchema.parse(await stale.json()).error.code).toBe("EVENT_CHANGED");
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM event_days WHERE event_id = ?")
        .bind(eventId)
        .first<number>("count"),
    ).toBe(1);

    const permissionRace = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?")
        .bind(writer.grantId)
        .run(),
    );
    const revoked = await callWithDatabase(writer.token, "/api/v1/events/pqc-2026/days", permissionRace, {
      method: "PUT",
      body: JSON.stringify({
        expectedUpdatedAt: firstPayload.eventUpdatedAt,
        configuration: {
          days: [
            {
              date: "2026-12-02",
              label: "Must not persist",
              attendanceOptions: [],
            },
          ],
        },
      }),
    });
    expect(revoked.status).toBe(409);
    expect(apiErrorPayloadSchema.parse(await revoked.json()).error.code).toBe("EVENT_CONFIGURATION_CONTEXT_CHANGED");
    expect(
      await queryAll<{ day_date: string; label: string }>(
        env.DB,
        "SELECT day_date, label FROM event_days WHERE event_id = ? ORDER BY day_date",
        [eventId],
      ),
    ).toEqual([{ day_date: "2026-12-01", label: "Conference day" }]);
  });

  it("rolls back event sponsor tiers and audit when the scoped write grant is revoked before commit", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const writer = await createEventStaff("events:write", eventId);
    const originalBody = JSON.stringify({ tiers: [{ tierName: "Leader", hasAttendeeDataAccess: true }] });
    expect(
      (
        await call(writer.token, "/api/v1/events/pqc-2026/sponsors/tiers", {
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
    const response = await callWithDatabase(writer.token, "/api/v1/events/pqc-2026/sponsors/tiers", racingDb, {
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
