import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../functions/router";
import type { DatabaseLike, Env } from "../functions/_lib/types";
import { getEventBySlug } from "../functions/_lib/services/events";
import { createRegistration } from "../functions/_lib/services/registrations";
import { eventRegistrationDetailResponseSchema } from "../assets/shared/schemas/event-registration-detail";
import { eventRegistrationsListResponseSchema } from "../assets/shared/schemas/event-registrations";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function callApi(path: string, token?: string, init: RequestInit = {}, db: DatabaseLike = env.DB) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return app.fetch(
    new Request(`https://app.test${path}`, { ...init, headers }),
    { ...(env as unknown as Env), DB: db },
    { passThroughOnException() {}, waitUntil() {} } as unknown as ExecutionContext,
  );
}

async function adminToken(): Promise<string> {
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
  return createAdminSession(env.DB, admin.id, `registration-admin-${crypto.randomUUID()}`);
}

async function scopedToken(eventId: string, permission: "events:read" | "events:write" | "events:manage") {
  const userId = await insertUser(env.DB, `${permission.replace(":", "-")}-${crypto.randomUUID()}@example.test`);
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
  const grantId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO permission_grants
       (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
     VALUES (?, ?, ?, 'event', ?, ?, datetime('now'))`,
  )
    .bind(grantId, userId, permission, eventId, admin.id)
    .run();
  return {
    grantId,
    userId,
    token: await createAdminSession(env.DB, userId, `registration-${permission}-${crypto.randomUUID()}`),
  };
}

async function registrationFixture() {
  const event = await getEventBySlug(env.DB, "pqc-2026");
  const userId = await insertUser(env.DB, `registration-${crypto.randomUUID()}@example.test`);
  const created = await createRegistration(env.DB, {
    event,
    userId,
    attendanceType: "virtual",
    sourceType: "direct",
    confirmationTtlHours: 48,
    signingSecret: "test-signing-secret",
  });
  return { event, userId, registrationId: created.registration.id };
}

describe("canonical event registration management", () => {
  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
  });

  it("serves the bounded full list and detail projection from canonical resource paths", async () => {
    const fixture = await registrationFixture();
    const token = await adminToken();

    const listResponse = await callApi("/api/v1/events/pqc-2026/registrations?limit=10&offset=0", token);
    expect(listResponse.status).toBe(200);
    const list = eventRegistrationsListResponseSchema.parse(await listResponse.json());
    expect(list.registrations.map(({ id }) => id)).toContain(fixture.registrationId);

    const detailResponse = await callApi(`/api/v1/events/pqc-2026/registrations/${fixture.registrationId}`, token);
    expect(detailResponse.status).toBe(200);
    expect(eventRegistrationDetailResponseSchema.parse(await detailResponse.json()).registration.id).toBe(
      fixture.registrationId,
    );
  });

  it("requires event management rather than broad event read or write access", async () => {
    const { event, registrationId } = await registrationFixture();
    for (const permission of ["events:read", "events:write"] as const) {
      const actor = await scopedToken(event.id, permission);
      const response = await callApi(`/api/v1/events/pqc-2026/registrations/${registrationId}`, actor.token);
      expect(response.status, permission).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "PERMISSION_REQUIRED" } });
    }

    const manager = await scopedToken(event.id, "events:manage");
    const allowed = await callApi(`/api/v1/events/pqc-2026/registrations/${registrationId}`, manager.token);
    expect(allowed.status).toBe(200);
  });

  it("rejects a registration that belongs to another event without exposing it", async () => {
    const fixture = await registrationFixture();
    const token = await adminToken();
    const response = await callApi(`/api/v1/events/not-the-event/registrations/${fixture.registrationId}`, token);
    expect(response.status).toBe(404);
  });

  it("rolls back when event-management authority is revoked after preflight", async () => {
    const fixture = await registrationFixture();
    const manager = await scopedToken(fixture.event.id, "events:manage");
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?")
        .bind(manager.grantId)
        .run(),
    );

    const response = await callApi(
      `/api/v1/events/pqc-2026/registrations/${fixture.registrationId}`,
      manager.token,
      {
        method: "PATCH",
        body: JSON.stringify({ action: "update", firstName: "Unauthorized" }),
      },
      racedDb,
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EVENT_REGISTRATION_AUTHORIZATION_CHANGED" },
    });
    const [user] = await queryAll<{ first_name: string | null }>(env.DB, "SELECT first_name FROM users WHERE id = ?", [
      fixture.userId,
    ]);
    expect(user.first_name).toBe("Test");
  });

  it("uses noun resources and validates notification creation", async () => {
    const fixture = await registrationFixture();
    const token = await adminToken();
    const invalid = await callApi(
      `/api/v1/events/pqc-2026/registrations/${fixture.registrationId}/notifications`,
      token,
      { method: "POST", body: JSON.stringify({ type: "unknown" }) },
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("does not retain legacy admin registration aliases", async () => {
    const fixture = await registrationFixture();
    const token = await adminToken();
    const retiredPaths = [
      "/api/v1/admin/events/pqc-2026/registrations",
      `/api/v1/admin/events/pqc-2026/registrations/${fixture.registrationId}`,
      "/api/v1/admin/events/pqc-2026/waitlist/promote",
    ];

    for (const path of retiredPaths) {
      expect((await callApi(path, token)).status, path).toBe(404);
    }
  });
});
