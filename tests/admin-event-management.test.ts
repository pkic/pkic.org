import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { getEventBySlug } from "../functions/_lib/services/events";
import { buildManagedEventsPageQuery, listManagedEvents } from "../functions/_lib/services/events/catalog";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import {
  createRegistration,
  confirmRegistrationByToken,
  updateRegistrationById,
} from "../functions/_lib/services/registrations";
import { eventRegistrationDetailResponseSchema } from "../assets/shared/schemas/event-registration-detail";
import { eventRegistrationsListResponseSchema } from "../assets/shared/schemas/event-registrations";
import { eventManagementDetailResponseSchema } from "../assets/shared/schemas/event-management";
import { eventImportResponseSchema } from "../assets/shared/schemas/event-imports";
import { buildEventRegistrationsPageQuery } from "../functions/_lib/services/registrations/event-registrations";
import { grantEventTeamRole, revokeEventTeamRole } from "../functions/_lib/services/events/team";
import { createUserBackedAuthAdmin } from "../functions/_lib/auth/admin-identity";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { insertUser } from "./helpers/membership";

let ADMIN_TOKEN = "event-admin-token";

function adminRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${ADMIN_TOKEN}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Request(`https://app.test${path}`, {
    ...init,
    headers,
  });
}

async function callAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    adminRequest(path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function setupAdmin(): Promise<{ baseEventId: string }> {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const adminRow = (
    await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
  )[0];
  ADMIN_TOKEN = await createAdminSession(env.DB, adminRow.id, ADMIN_TOKEN);
  return { baseEventId: eventId };
}

/**
 * Ownerless events are no longer created interactively. Tests that need one
 * import it through the canonical event import resource, which is the only
 * remaining way to introduce an event without an owning group.
 */
async function importEvent(slug: string, name: string, event: Record<string, unknown> = {}): Promise<Response> {
  return callAdmin("/api/v1/events/imports", {
    method: "POST",
    body: JSON.stringify({ source: "hugo", event: { slug, name, timezone: "UTC", ...event } }),
  });
}

async function eventUpdatedAt(slug = "pqc-2026"): Promise<string> {
  const [row] = await queryAll<{ updated_at: string }>(env.DB, "SELECT updated_at FROM events WHERE slug = ?", [slug]);
  return row.updated_at;
}

async function createScopedEventManager(eventId: string) {
  const email = `event-manager-${crypto.randomUUID()}@example.test`;
  const userId = await insertUser(env.DB, email);
  const roleAssignmentId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'role-event_organizer', 'event', ?, ?, datetime('now'))`,
  )
    .bind(roleAssignmentId, userId, eventId, userId)
    .run();

  return {
    email,
    userId,
    actor: createUserBackedAuthAdmin({
      id: userId,
      email,
      role: "user",
      scopes: [],
      grants: [{ permission: "events:manage", contextType: "event", contextId: eventId }],
    }),
    roleAssignmentId,
  };
}

describe("admin event management endpoints", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("retires ownerless admin event creation and lists through the canonical collection", async () => {
    await setupAdmin();

    // Interactive ownerless creation is gone; events are created in the portal
    // under an owning group, or imported from an external generator.
    const retired = await callAdmin("/api/v1/admin/events", {
      method: "POST",
      body: JSON.stringify({ slug: "pqc-2027", name: "PQC 2027", timezone: "Europe/Amsterdam" }),
    });
    expect(retired.status).toBe(404);

    const imported = await importEvent("pqc-2027", "PQC 2027", {
      timezone: "Europe/Amsterdam",
      startsAt: "2027-04-12T08:00:00.000Z",
      endsAt: "2027-04-14T17:00:00.000Z",
      registrationMode: "open",
      inviteLimitAttendee: 10,
    });
    expect(imported.status).toBe(200);
    const importedPayload = eventImportResponseSchema.parse(await imported.json());
    expect(importedPayload.event.slug).toBe("pqc-2027");
    expect(importedPayload.created).toBe(true);

    // Re-importing the same slug updates rather than conflicting.
    const reimported = await importEvent("pqc-2027", "PQC 2027 Updated", { timezone: "Europe/Amsterdam" });
    expect(reimported.status).toBe(200);
    expect(eventImportResponseSchema.parse(await reimported.json()).created).toBe(false);

    const listResponse = await callAdmin("/api/v1/events");
    expect(listResponse.status).toBe(200);
    const listPayload = (await listResponse.json()) as {
      events: Array<{ slug: string; totalRegistrations?: number }>;
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(listPayload.events.map((event) => event.slug)).toEqual(expect.arrayContaining(["pqc-2026", "pqc-2027"]));
    expect(listPayload.page.total).toBeGreaterThanOrEqual(2);
    // An events:read holder receives the management projection.
    expect(listPayload.events[0].totalRegistrations).toBeDefined();
  });

  it("rejects an import that would retarget an event owned by another source", async () => {
    await setupAdmin();
    await env.DB.prepare("UPDATE events SET source_mode = 'portal' WHERE slug = 'pqc-2026'").run();

    const response = await importEvent("pqc-2026", "Hijacked", {});
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "EVENT_SOURCE_CONFLICT" } });
  });

  it("validates admin event and form mutations through the canonical JSON boundary", async () => {
    await setupAdmin();

    for (const [path, method] of [
      ["/api/v1/events/imports", "POST"],
      ["/api/v1/forms", "POST"],
      ["/api/v1/events/pqc-2026/forms", "POST"],
    ] as const) {
      const response = await callAdmin(path, { method, body: "{not-json" });
      expect(response.status, `${method} ${path}`).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "INVALID_JSON", message: "Request body must be valid JSON" },
      });
    }
  });

  it("P6M-P2-04: bounds the events list with ?limit=/?offset= via the query schema (data.query, not a fetch-everything scan)", async () => {
    await setupAdmin();
    await importEvent("bounded-a", "Bounded A");
    await importEvent("bounded-b", "Bounded B");

    const firstPage = await callAdmin("/api/v1/events?limit=1&offset=0");
    expect(firstPage.status).toBe(200);
    const firstBody = (await firstPage.json()) as {
      events: unknown[];
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(firstBody.events).toHaveLength(1);
    expect(firstBody.page.limit).toBe(1);
    expect(firstBody.page.hasMore).toBe(true);
    expect(firstBody.page.total).toBeGreaterThanOrEqual(3);

    const searched = await callAdmin("/api/v1/events?q=bounded-b");
    const searchedBody = (await searched.json()) as { events: Array<{ slug: string }>; page: { total: number } };
    expect(searchedBody.events.map(({ slug }) => slug)).toEqual(["bounded-b"]);
    expect(searchedBody.page.total).toBe(1);

    const invalidLimit = await callAdmin("/api/v1/events?limit=0");
    expect(invalidLimit.status).toBe(400);
  });

  it("aggregates only the returned event page, not unrelated events", async () => {
    await setupAdmin();
    const pageEventId = crypto.randomUUID();
    const unrelatedEventId = crypto.randomUUID();
    const pageUserId = crypto.randomUUID();
    const unrelatedUserIds = Array.from({ length: 3 }, () => crypto.randomUUID());
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO events
           (id, slug, name, timezone, starts_at, ends_at, registration_mode, invite_limit_attendee, settings_json, created_at, updated_at)
         VALUES (?, 'a-page-event', 'A page event', 'UTC', '2027-01-01T09:00:00.000Z', '2027-01-01T17:00:00.000Z', 'open', 5, '{}', datetime('now'), datetime('now'))`,
      ).bind(pageEventId),
      env.DB.prepare(
        `INSERT INTO events
           (id, slug, name, timezone, starts_at, ends_at, registration_mode, invite_limit_attendee, settings_json, created_at, updated_at)
         VALUES (?, 'z-unrelated-event', 'Z unrelated event', 'UTC', '2027-01-01T09:00:00.000Z', '2027-01-01T17:00:00.000Z', 'open', 5, '{}', datetime('now'), datetime('now'))`,
      ).bind(unrelatedEventId),
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
         VALUES (?, 'page-event@example.test', 'page-event@example.test', 'user', 1, datetime('now'), datetime('now'))`,
      ).bind(pageUserId),
      ...unrelatedUserIds.map((userId, index) =>
        env.DB.prepare(
          `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
           VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
        ).bind(userId, `unrelated-${index}@example.test`, `unrelated-${index}@example.test`),
      ),
      env.DB.prepare(
        `INSERT INTO registrations
           (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
         VALUES (?, ?, ?, 'registered', 'in_person', 'direct', ?, datetime('now'), datetime('now'))`,
      ).bind(crypto.randomUUID(), pageEventId, pageUserId, `page-manage-${crypto.randomUUID()}`),
      ...unrelatedUserIds.map((userId) =>
        env.DB.prepare(
          `INSERT INTO registrations
             (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
           VALUES (?, ?, ?, 'registered', 'in_person', 'direct', ?, datetime('now'), datetime('now'))`,
        ).bind(crypto.randomUUID(), unrelatedEventId, userId, `unrelated-manage-${crypto.randomUUID()}`),
      ),
      env.DB.prepare(
        `INSERT INTO invites
           (id, event_id, invitee_email, invite_type, link_secret, status, source_type, created_at)
         VALUES (?, ?, 'page-invite@example.test', 'attendee', ?, 'sent', 'direct', datetime('now'))`,
      ).bind(crypto.randomUUID(), pageEventId, `page-invite-${crypto.randomUUID()}`),
      env.DB.prepare(
        `INSERT INTO invites
           (id, event_id, invitee_email, invite_type, link_secret, status, source_type, expires_at, created_at)
         VALUES (?, ?, 'expired-page-invite@example.test', 'attendee', ?, 'sent', 'direct', '2026-01-01T00:00:00.000Z', datetime('now'))`,
      ).bind(crypto.randomUUID(), pageEventId, `expired-page-invite-${crypto.randomUUID()}`),
      env.DB.prepare(
        `INSERT INTO invites
           (id, event_id, invitee_email, invite_type, link_secret, status, source_type, created_at)
         VALUES (?, ?, 'unrelated-invite@example.test', 'attendee', ?, 'sent', 'direct', datetime('now'))`,
      ).bind(crypto.randomUUID(), unrelatedEventId, `unrelated-invite-${crypto.randomUUID()}`),
    ]);

    const result = await listManagedEvents(
      env.DB,
      { userId: "admin-user", canReadAll: true },
      { limit: 1, offset: 0, sort: "name" },
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: pageEventId,
      totalRegistrations: 1,
      confirmedRegistrations: 1,
      pendingInvites: 1,
    });
    expect(result.total).toBeGreaterThanOrEqual(3);
  });

  it("keeps the event count plan independent of registration and invite projections", async () => {
    await setupAdmin();
    const query = buildManagedEventsPageQuery({ userId: "admin-user", canReadAll: true }, { limit: 1, offset: 0 });
    const { pageSql, countSql, bindings } = buildOffsetPageSql(query);
    const [pagePlan, countPlan] = await Promise.all([
      env.DB.prepare(`EXPLAIN QUERY PLAN ${pageSql}`)
        .bind(...bindings, query.limit, query.offset)
        .all(),
      env.DB.prepare(`EXPLAIN QUERY PLAN ${countSql}`)
        .bind(...bindings)
        .all(),
    ]);

    expect(pagePlan.results.length).toBeGreaterThan(0);
    expect(countPlan.results.length).toBeGreaterThan(0);
    expect(countSql).not.toMatch(/registrations|invites|total_registrations|pending_invites/i);
    expect(pageSql).not.toMatch(/registration_counts|invite_counts/);
  });

  it("keeps registration count predicates while excluding outbox and RSVP projections", async () => {
    const { baseEventId } = await setupAdmin();
    const query = buildEventRegistrationsPageQuery(baseEventId, {
      limit: 10,
      offset: 0,
      status: "registered",
      consent: "true",
      attendance_change: "joined_in_person",
      q: "attendee",
    });
    const { pageSql, countSql, bindings, countBindings } = buildOffsetPageSql(query);

    expect(pageSql).toMatch(/calendar_rsvp_events|JSON_GROUP_ARRAY|email_outbox/i);
    expect(countSql).not.toMatch(/calendar_rsvp_events|JSON_GROUP_ARRAY|ROW_NUMBER|rsvp_events_json/i);
    expect(pageSql).not.toMatch(/JOIN referral_codes/i);
    expect(countSql).not.toMatch(/referral_codes/i);
    expect(countSql).toContain("r.event_id = ?");
    expect(countSql).toContain("r.status = ?");
    expect(countBindings).toEqual(bindings);
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

  it("returns one registration and one deterministic referral code when an owner has multiple codes", async () => {
    const { baseEventId } = await setupAdmin();
    const userId = crypto.randomUUID();
    const registrationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
         VALUES (?, 'multi-referral@example.test', 'multi-referral@example.test', 'user', 1, datetime('now'), datetime('now'))`,
      ).bind(userId),
      env.DB.prepare(
        `INSERT INTO registrations
           (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
         VALUES (?, ?, ?, 'registered', 'virtual', 'direct', ?, datetime('now'), datetime('now'))`,
      ).bind(registrationId, baseEventId, userId, `manage-${crypto.randomUUID()}`),
      env.DB.prepare(
        `INSERT INTO referral_codes
           (code, event_id, owner_type, owner_id, created_by_user_id, clicks, conversions, created_at)
         VALUES ('second02', ?, 'registration', ?, ?, 0, 0, '2026-01-02T00:00:00.000Z')`,
      ).bind(baseEventId, registrationId, userId),
      env.DB.prepare(
        `INSERT INTO referral_codes
           (code, event_id, owner_type, owner_id, created_by_user_id, clicks, conversions, created_at)
         VALUES ('first001', ?, 'registration', ?, ?, 0, 0, '2026-01-01T00:00:00.000Z')`,
      ).bind(baseEventId, registrationId, userId),
    ]);

    const listResponse = await callAdmin("/api/v1/admin/events/pqc-2026/registrations");
    expect(listResponse.status).toBe(200);
    const list = eventRegistrationsListResponseSchema.parse(await listResponse.json());
    expect(list.page.total).toBe(1);
    expect(list.registrations).toEqual([expect.objectContaining({ id: registrationId, referral_code: "first001" })]);

    const detailResponse = await callAdmin(`/api/v1/admin/events/pqc-2026/registrations/${registrationId}`);
    expect(detailResponse.status).toBe(200);
    const detail = eventRegistrationDetailResponseSchema.parse(await detailResponse.json());
    expect(detail.registration.referral_code).toBe("first001");
  });

  it("returns details and persists settings updates", async () => {
    await setupAdmin();

    const detailResponse = await callAdmin("/api/v1/events/pqc-2026");
    expect(detailResponse.status).toBe(200);
    const detailPayload = eventManagementDetailResponseSchema.parse(await detailResponse.json());
    expect(detailPayload.event.slug).toBe("pqc-2026");

    const patchResponse = await callAdmin("/api/v1/events/pqc-2026/settings", {
      method: "PATCH",
      body: JSON.stringify({
        expectedUpdatedAt: detailPayload.event.updatedAt,
        name: "PQC Conference 2026 - Updated",
        venue: "The Hague Conference Center",
        virtualUrl: "https://pkic.org/live/pqc-2026/",
        userRetentionDays: 180,
        sessionTypes: [
          { label: "talk", requiresPresentation: true },
          { label: "panel", requiresPresentation: false },
        ],
        registrationFormKey: "pqc-reg-form",
        proposalFormKey: null,
      }),
    });

    expect(patchResponse.status).toBe(200);
    const patchPayload = eventManagementDetailResponseSchema.parse(await patchResponse.json());
    expect(patchPayload.event.name).toBe("PQC Conference 2026 - Updated");
    expect(patchPayload.event.settings.venue).toBe("The Hague Conference Center");
    expect(patchPayload.event.settings.virtualUrl).toBe("https://pkic.org/live/pqc-2026/");
    expect(patchPayload.event.userRetentionDays).toBe(180);
    expect(
      (
        patchPayload.event.settings.proposal as
          { sessionTypes?: { label: string; requiresPresentation: boolean }[] } | undefined
      )?.sessionTypes,
    ).toEqual([
      { label: "talk", requiresPresentation: true },
      { label: "panel", requiresPresentation: false },
    ]);
    expect(
      patchPayload.event.settings.forms as
        { event_registration?: string | null; proposal_submission?: string | null } | undefined,
    ).toEqual({
      event_registration: "pqc-reg-form",
      proposal_submission: null,
    });
  });

  it("keeps portal-owned registration authoring in the owning group context", async () => {
    await setupAdmin();
    await env.DB.prepare("UPDATE events SET owner_group_id = ?, source_mode = 'portal' WHERE slug = 'pqc-2026'")
      .bind("20000000-0000-4000-8000-000000000001")
      .run();

    const detailResponse = await callAdmin("/api/v1/events/pqc-2026");
    expect(detailResponse.status).toBe(200);
    const detail = eventManagementDetailResponseSchema.parse(await detailResponse.json());
    expect(detail.event).toMatchObject({
      ownerGroupId: "20000000-0000-4000-8000-000000000001",
      sourceMode: "portal",
    });

    const settingsResponse = await callAdmin("/api/v1/events/pqc-2026/settings", {
      method: "PATCH",
      body: JSON.stringify({ expectedUpdatedAt: detail.event.updatedAt, registrationPolicy: "public" }),
    });
    expect(settingsResponse.status).toBe(409);
    await expect(settingsResponse.json()).resolves.toMatchObject({
      error: { code: "EVENT_MANAGED_BY_GROUP" },
    });

    const formResponse = await callAdmin("/api/v1/events/pqc-2026/forms", {
      method: "POST",
      body: JSON.stringify({
        key: "portal-event-form",
        purpose: "event_registration",
        title: "Portal event form",
        status: "active",
        fields: [],
      }),
    });
    expect(formResponse.status).toBe(403);
    await expect(formResponse.json()).resolves.toMatchObject({
      error: { code: "PORTAL_EVENT_FORMS_OWNED_BY_GROUP" },
    });
  });

  it("rejects duplicate configurable session types case-insensitively", async () => {
    await setupAdmin();

    const response = await callAdmin("/api/v1/events/pqc-2026/settings", {
      method: "PATCH",
      body: JSON.stringify({
        expectedUpdatedAt: await eventUpdatedAt(),
        sessionTypes: [
          { label: "Ask Me Anything", requiresPresentation: false },
          { label: "ask me anything", requiresPresentation: true },
        ],
      }),
    });

    expect(response.status).toBe(400);
  });

  it("manages event team roles through the canonical event resource", async () => {
    await setupAdmin();

    const roleResponse = await callAdmin("/api/v1/events/pqc-2026/roles", {
      method: "POST",
      body: JSON.stringify({
        userEmail: "organizer@example.test",
        role: "organizer",
      }),
    });

    expect(roleResponse.status).toBe(201);
    const rolePayload = (await roleResponse.json()) as {
      role: { id: string; userEmail: string; role: string };
    };
    expect(rolePayload.role.userEmail).toBe("organizer@example.test");
    expect(rolePayload.role.role).toBe("organizer");
    expect(
      await queryAll<{ normalized_email: string }>(
        env.DB,
        `SELECT u.normalized_email
           FROM user_roles ur JOIN users u ON u.id = ur.user_id
          WHERE ur.id = ?`,
        rolePayload.role.id,
      ),
    ).toEqual([{ normalized_email: "organizer@example.test" }]);

    const duplicateRoleResponse = await callAdmin("/api/v1/events/pqc-2026/roles", {
      method: "POST",
      body: JSON.stringify({
        userEmail: "organizer@example.test",
        role: "organizer",
      }),
    });

    expect(duplicateRoleResponse.status).toBe(409);

    const roleListResponse = await callAdmin("/api/v1/events/pqc-2026/roles");
    expect(roleListResponse.status).toBe(200);
    const roleListPayload = (await roleListResponse.json()) as {
      roles: Array<{ userEmail: string; role: string }>;
    };
    expect(roleListPayload.roles).toEqual(
      expect.arrayContaining([expect.objectContaining({ userEmail: "organizer@example.test", role: "organizer" })]),
    );
  });

  it("P6M-P2-06: searches, bounds, and sorts the event-team roles list", async () => {
    await setupAdmin();

    for (const [email, role] of [
      ["p1@example.test", "organizer"],
      ["p2@example.test", "moderator"],
      ["p3@example.test", "volunteer"],
    ] as const) {
      const res = await callAdmin("/api/v1/events/pqc-2026/roles", {
        method: "POST",
        body: JSON.stringify({ userEmail: email, role }),
      });
      expect(res.status).toBe(201);
    }

    const firstPage = await callAdmin("/api/v1/events/pqc-2026/roles?limit=2&offset=0");
    expect(firstPage.status).toBe(200);
    const firstBody = (await firstPage.json()) as {
      roles: unknown[];
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(firstBody.roles).toHaveLength(2);
    expect(firstBody.page).toEqual({ limit: 2, offset: 0, total: 3, hasMore: true });

    const searched = await callAdmin("/api/v1/events/pqc-2026/roles?q=p2%40example.test");
    const searchedBody = (await searched.json()) as {
      roles: Array<{ userEmail: string }>;
      page: { total: number };
    };
    expect(searchedBody.roles.map(({ userEmail }) => userEmail)).toEqual(["p2@example.test"]);
    expect(searchedBody.page.total).toBe(1);

    const sorted = await callAdmin("/api/v1/events/pqc-2026/roles?sort=createdAt");
    expect(sorted.status).toBe(200);

    const invalidLimit = await callAdmin("/api/v1/events/pqc-2026/roles?limit=0");
    expect(invalidLimit.status).toBe(400);
  });

  it("rejects API-key identities for event-team role writes", async () => {
    await setupAdmin();
    ADMIN_TOKEN = env.ADMIN_API_KEY ?? "test-admin-key";

    const response = await callAdmin("/api/v1/events/pqc-2026/roles", {
      method: "POST",
      body: JSON.stringify({ userEmail: "api-key-organizer@example.test", role: "organizer" }),
    });

    expect(response.status).toBe(403);
    expect(
      await queryAll<{ id: string }>(
        env.DB,
        `SELECT ur.id
           FROM user_roles ur JOIN users u ON u.id = ur.user_id
          WHERE u.normalized_email = 'api-key-organizer@example.test'`,
      ),
    ).toEqual([]);
  });

  it("enforces live event-scoped management permission on every role operation", async () => {
    const { baseEventId } = await setupAdmin();
    const readerId = await insertUser(env.DB, `event-team-reader-${crypto.randomUUID()}@example.test`);
    await env.DB.prepare(
      `INSERT INTO permission_grants
         (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'events:read', 'event', ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), readerId, baseEventId, readerId)
      .run();
    ADMIN_TOKEN = await createAdminSession(env.DB, readerId, `event-team-reader-${crypto.randomUUID()}`);
    expect((await callAdmin("/api/v1/events/pqc-2026/roles")).status).toBe(403);

    const manager = await createScopedEventManager(baseEventId);
    ADMIN_TOKEN = await createAdminSession(env.DB, manager.userId, `event-team-manager-${crypto.randomUUID()}`);

    const assigned = await callAdmin("/api/v1/events/pqc-2026/roles", {
      method: "POST",
      body: JSON.stringify({ userEmail: "scoped-team-member@example.test", role: "moderator" }),
    });
    expect(assigned.status).toBe(201);
    const assignment = (await assigned.json()) as { role: { id: string } };
    expect((await callAdmin("/api/v1/events/pqc-2026/roles")).status).toBe(200);

    await env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE id = ?")
      .bind(manager.roleAssignmentId)
      .run();

    expect((await callAdmin("/api/v1/events/pqc-2026/roles")).status).toBe(401);
    expect(
      (
        await callAdmin(`/api/v1/events/pqc-2026/roles/${assignment.role.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(401);
    expect(
      await queryAll<{ revoked_at: string | null }>(env.DB, "SELECT revoked_at FROM user_roles WHERE id = ?", [
        assignment.role.id,
      ]),
    ).toEqual([{ revoked_at: null }]);
  });

  it("rolls back an event-team grant when the scoped manager loses authority before commit", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { actor, roleAssignmentId } = await createScopedEventManager(eventId);
    const targetEmail = `event-team-create-race-${crypto.randomUUID()}@example.test`;
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE id = ?").bind(roleAssignmentId).run(),
    );

    await expect(
      grantEventTeamRole(racedDb, actor, "pqc-2026", { userEmail: targetEmail, role: "organizer" }),
    ).rejects.toMatchObject({ status: 409, code: "ACCESS_CONTROL_AUTHORIZATION_CHANGED" });
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [targetEmail])).toHaveLength(0);
    expect(
      await queryAll(
        env.DB,
        `SELECT ur.id
           FROM user_roles ur
           JOIN users u ON u.id = ur.user_id
          WHERE u.normalized_email = ? AND ur.context_type = 'event' AND ur.context_id = ?`,
        [targetEmail, eventId],
      ),
    ).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'event_team_role_assigned' AND entity_id = ?", [
        eventId,
      ]),
    ).toHaveLength(0);
  });

  it("reports a conflict without a false event-team revoke audit when the target is concurrently revoked", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { actor } = await createScopedEventManager(eventId);
    const targetEmail = `event-team-target-race-${crypto.randomUUID()}@example.test`;
    const created = await grantEventTeamRole(env.DB, actor, "pqc-2026", {
      userEmail: targetEmail,
      role: "organizer",
    });
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE id = ?").bind(created.id).run(),
    );

    await expect(revokeEventTeamRole(racedDb, actor, "pqc-2026", created.id)).rejects.toMatchObject({
      status: 409,
      code: "ACCESS_CONTROL_TARGET_CHANGED",
    });
    expect(
      await queryAll<{ revoked_at: string | null }>(env.DB, "SELECT revoked_at FROM user_roles WHERE id = ?", [
        created.id,
      ]),
    ).toEqual([expect.objectContaining({ revoked_at: expect.any(String) })]);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'event_team_role_revoked' AND entity_id = ?", [
        eventId,
      ]),
    ).toHaveLength(0);
  });

  it("rolls back an event-team revoke when the scoped manager loses authority before commit", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { actor, roleAssignmentId } = await createScopedEventManager(eventId);
    const created = await grantEventTeamRole(env.DB, actor, "pqc-2026", {
      userEmail: `event-team-revoke-race-${crypto.randomUUID()}@example.test`,
      role: "organizer",
    });
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE id = ?").bind(roleAssignmentId).run(),
    );

    await expect(revokeEventTeamRole(racedDb, actor, "pqc-2026", created.id)).rejects.toMatchObject({
      status: 409,
      code: "ACCESS_CONTROL_AUTHORIZATION_CHANGED",
    });
    expect(
      await queryAll<{ revoked_at: string | null }>(env.DB, "SELECT revoked_at FROM user_roles WHERE id = ?", [
        created.id,
      ]),
    ).toEqual([{ revoked_at: null }]);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'event_team_role_revoked' AND entity_id = ?", [
        eventId,
      ]),
    ).toHaveLength(0);
  });

  it("allows admin to reinstate a cancelled registration and rejects double-cancel", async () => {
    await setupAdmin();

    const userId = crypto.randomUUID();

    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, created_at, updated_at)
       VALUES (?, 'reinstate@example.test', 'reinstate@example.test', datetime('now'), datetime('now'))`,
    )
      .bind(userId)
      .run();

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const created = await createRegistration(env.DB, {
      event,
      userId,
      attendanceType: "virtual",
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: created.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    // Cancel via the service (simulates attendee or earlier admin action)
    const cancelled = await updateRegistrationById(
      env.DB,
      { eventId: event.id, registrationId: created.registration.id, action: "cancel", waitlistClaimWindowHours: 24 },
      "admin:test",
    );
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelled_at).not.toBeNull();

    const detailResponse = await callAdmin(`/api/v1/admin/events/pqc-2026/registrations/${created.registration.id}`);
    expect(detailResponse.status).toBe(200);
    const rawDetail = await detailResponse.json();
    const detail = eventRegistrationDetailResponseSchema.parse(rawDetail);
    expect(detail.registration.status).toBe("cancelled");
    expect(rawDetail).not.toHaveProperty("registration.custom_answers_json");
    expect(rawDetail).not.toHaveProperty("registration.manage_link_secret");

    // Double-cancel must still be rejected
    await expect(
      updateRegistrationById(
        env.DB,
        { eventId: event.id, registrationId: created.registration.id, action: "cancel", waitlistClaimWindowHours: 24 },
        "admin:test",
      ),
    ).rejects.toMatchObject({ code: "ALREADY_CANCELLED" });

    // Admin reinstates via the HTTP endpoint
    const reinstateResponse = await callAdmin(
      `/api/v1/admin/events/pqc-2026/registrations/${created.registration.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ action: "update", attendanceType: "virtual" }),
      },
    );
    expect(reinstateResponse.status).toBe(200);
    const reinstatePayload = (await reinstateResponse.json()) as { success: boolean; registration: { status: string } };
    expect(reinstatePayload.success).toBe(true);
    expect(reinstatePayload.registration.status).toBe("registered");

    const row = (
      await queryAll<{ cancelled_at: string | null }>(
        env.DB,
        "SELECT cancelled_at FROM registrations WHERE id = ?",
        created.registration.id,
      )
    )[0];
    expect(row.cancelled_at).toBeNull();
  });

  it("does not let an event route mutate a registration owned by another event", async () => {
    await setupAdmin();
    const createEventResponse = await importEvent("other-event", "Other Event");
    expect(createEventResponse.status).toBe(200);

    const otherEvent = await getEventBySlug(env.DB, "other-event");
    const userId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, created_at, updated_at)
       VALUES (?, 'cross-event@example.test', 'cross-event@example.test', datetime('now'), datetime('now'))`,
    )
      .bind(userId)
      .run();
    const created = await createRegistration(env.DB, {
      event: otherEvent,
      userId,
      attendanceType: "in_person",
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    const wrongEventPath = `/api/v1/admin/events/pqc-2026/registrations/${created.registration.id}`;
    const ordinaryUpdate = await callAdmin(wrongEventPath, {
      method: "PATCH",
      body: JSON.stringify({ action: "update", attendanceType: "virtual" }),
    });
    expect(ordinaryUpdate.status).toBe(404);

    const emailUpdate = await callAdmin(wrongEventPath, {
      method: "PATCH",
      body: JSON.stringify({ action: "update", email: "cross-event-new@example.test" }),
    });
    expect(emailUpdate.status).toBe(404);

    expect(
      await queryAll<{ attendance_type: string; status: string }>(
        env.DB,
        "SELECT attendance_type, status FROM registrations WHERE id = ?",
        created.registration.id,
      ),
    ).toEqual([{ attendance_type: "in_person", status: "pending_email_confirmation" }]);
    expect(
      await queryAll<{ email: string; pending_email: string | null }>(
        env.DB,
        "SELECT email, pending_email FROM users WHERE id = ?",
        userId,
      ),
    ).toEqual([{ email: "cross-event@example.test", pending_email: null }]);
  });

  it("rejects an admin scalar-only attendance change when day attendance is canonical", async () => {
    const { baseEventId } = await setupAdmin();
    const userId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
         VALUES ('admin-scalar-day', ?, '2026-12-01', 'Day 1', 1, 0, datetime('now'), datetime('now'))`,
      ).bind(baseEventId),
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
         VALUES (?, 'admin-scalar@example.test', 'admin-scalar@example.test', 'Admin', 'Scalar', datetime('now'), datetime('now'))`,
      ).bind(userId),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const created = await createRegistration(env.DB, {
      event,
      userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    const response = await callAdmin(`/api/v1/admin/events/pqc-2026/registrations/${created.registration.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "update", attendanceType: "virtual" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "DAY_ATTENDANCE_REQUIRED" },
    });
    await expect(
      queryAll<{ attendance_type: string }>(env.DB, "SELECT attendance_type FROM registrations WHERE id = ?", [
        created.registration.id,
      ]),
    ).resolves.toEqual([{ attendance_type: "in_person" }]);
    await expect(
      queryAll<{ attendance_type: string }>(
        env.DB,
        `SELECT rda.attendance_type FROM registration_day_attendance rda
         WHERE rda.registration_id = ?`,
        [created.registration.id],
      ),
    ).resolves.toEqual([{ attendance_type: "in_person" }]);
  });

  it("separates accepted attendees from active day waitlists in both event statistics views", async () => {
    const { baseEventId } = await setupAdmin();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('statistics-day-1', '${baseEventId}', '2026-12-01', 'Day 1', 1, 0, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES
          ('statistics-accepted', 'accepted@example.test', 'accepted@example.test', 'Accepted', 'Attendee', datetime('now'), datetime('now')),
          ('statistics-waitlisted', 'waitlisted@example.test', 'waitlisted@example.test', 'Waitlisted', 'Attendee', datetime('now'), datetime('now')),
          ('statistics-virtual', 'virtual@example.test', 'virtual@example.test', 'Virtual', 'Attendee', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const accepted = await createRegistration(env.DB, {
      event,
      userId: "statistics-accepted",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: accepted.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const waitlisted = await createRegistration(env.DB, {
      event,
      userId: "statistics-waitlisted",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: waitlisted.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const virtual = await createRegistration(env.DB, {
      event,
      userId: "statistics-virtual",
      attendanceType: "virtual",
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: virtual.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const overviewResponse = await callAdmin("/api/v1/admin/events/pqc-2026/registrations");
    expect(overviewResponse.status).toBe(200);
    const overview = (await overviewResponse.json()) as {
      stats: {
        byAttendanceType: Record<string, number>;
        attendanceStatusByType: Record<string, { accepted: number; waitlisted: number }>;
      };
    };
    expect(overview.stats.byAttendanceType).toMatchObject({ in_person: 2, virtual: 1 });
    expect(overview.stats.attendanceStatusByType).toMatchObject({
      in_person: { accepted: 1, waitlisted: 1 },
      virtual: { accepted: 1, waitlisted: 0 },
    });

    const statsResponse = await callAdmin("/api/v1/events/pqc-2026/analytics");
    expect(statsResponse.status).toBe(200);
    const stats = (await statsResponse.json()) as {
      registrations: {
        attendanceStatusByType: Record<string, { accepted: number; waitlisted: number }>;
      };
      registrationsByEventDay: Array<{ attendance_type: string; attendance_status: string; count: number }>;
    };
    expect(stats.registrations.attendanceStatusByType).toEqual(overview.stats.attendanceStatusByType);
    expect(stats.registrationsByEventDay).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attendance_type: "in_person", attendance_status: "accepted", count: 1 }),
        expect.objectContaining({ attendance_type: "in_person", attendance_status: "waitlisted", count: 1 }),
      ]),
    );

    const platformStatsResponse = await callAdmin("/api/v1/analytics/summary");
    expect(platformStatsResponse.status).toBe(200);
    const platformStats = (await platformStatsResponse.json()) as {
      topEvents: Array<{ slug: string; confirmed: number; total: number }>;
    };
    expect(platformStats.topEvents).toContainEqual(
      expect.objectContaining({ slug: "pqc-2026", confirmed: 3, total: 3 }),
    );
  });

  it("preserves system history when a cancelled registration is reactivated", async () => {
    const { baseEventId } = await setupAdmin();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('reactivation-day', '${baseEventId}', '2026-12-01', 'Day 1', 10, 0, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES ('reactivation-attendee', 'reactivation@example.test', 'reactivation@example.test',
                'Reactivated', 'Attendee', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const original = await createRegistration(env.DB, {
      event,
      userId: "reactivation-attendee",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await env.DB.prepare("UPDATE registrations SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?")
      .bind(original.registration.id)
      .run();

    const reactivated = await createRegistration(env.DB, {
      event,
      userId: "reactivation-attendee",
      attendanceType: "virtual",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "virtual" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    expect(reactivated.reactivated).toBe(true);
    expect(reactivated.registration.id).toBe(original.registration.id);
    const history = await queryAll<{ from_type: string; to_type: string; changed_by: string }>(
      env.DB,
      `SELECT from_type, to_type, changed_by
       FROM registration_attendance_history
       WHERE registration_id = ?`,
      [original.registration.id],
    );
    expect(history).toEqual([{ from_type: "in_person", to_type: "virtual", changed_by: "system" }]);

    const statsResponse = await callAdmin("/api/v1/events/pqc-2026/analytics");
    expect(statsResponse.status).toBe(200);
    const stats = (await statsResponse.json()) as {
      attendanceChanges: { changedAttendees: number; dayChanges: number };
    };
    expect(stats.attendanceChanges).toMatchObject({ changedAttendees: 0, dayChanges: 0 });
  });

  it("counts nullable legacy history as a move into in-person attendance", async () => {
    const { baseEventId } = await setupAdmin();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('legacy-movement-day', '${baseEventId}', '2026-12-01', 'Day 1', 10, 0, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES ('legacy-movement-attendee', 'legacy-movement@example.test', 'legacy-movement@example.test',
                'Legacy', 'Movement', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const created = await createRegistration(env.DB, {
      event,
      userId: "legacy-movement-attendee",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await env.DB.prepare(
      `INSERT INTO registration_attendance_history (
         id, registration_id, event_day_id, from_type, to_type, changed_by, changed_at
       ) VALUES ('legacy-null-transition', ?, 'legacy-movement-day', NULL, 'in_person', 'admin:test', datetime('now'))`,
    )
      .bind(created.registration.id)
      .run();

    const statsResponse = await callAdmin("/api/v1/events/pqc-2026/analytics");
    expect(statsResponse.status).toBe(200);
    const stats = (await statsResponse.json()) as {
      attendanceChanges: {
        changedAttendees: number;
        joinedInPersonAttendees: number;
        joinedInPersonDayChanges: number;
        byTransition: Array<{ from_type: string; to_type: string; attendees: number }>;
      };
    };
    expect(stats.attendanceChanges).toMatchObject({
      changedAttendees: 1,
      joinedInPersonAttendees: 1,
      joinedInPersonDayChanges: 1,
    });
    expect(stats.attendanceChanges.byTransition).toContainEqual({
      from_type: "not_attending",
      to_type: "in_person",
      attendees: 1,
      day_changes: 1,
    });

    const joinedResponse = await callAdmin(
      "/api/v1/admin/events/pqc-2026/registrations?attendance_change=joined_in_person",
    );
    expect(joinedResponse.status).toBe(200);
    const joined = (await joinedResponse.json()) as { registrations: Array<{ id: string }>; page: { total: number } };
    expect(joined.page.total).toBe(1);
    expect(joined.registrations[0]?.id).toBe(created.registration.id);
  });

  it("counts multi-day attendance movement once per attendee and separately per day", async () => {
    const { baseEventId } = await setupAdmin();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES
          ('movement-day-1', '${baseEventId}', '2026-12-01', 'Day 1', 10, 0, datetime('now'), datetime('now')),
          ('movement-day-2', '${baseEventId}', '2026-12-02', 'Day 2', 10, 1, datetime('now'), datetime('now')),
          ('movement-day-3', '${baseEventId}', '2026-12-03', 'Day 3', 10, 2, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES ('movement-attendee', 'movement@example.test', 'movement@example.test', 'Movement', 'Attendee', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const dayAttendance = ["01", "02", "03"].map((day) => ({
      dayDate: `2026-12-${day}`,
      attendanceType: "in_person" as const,
    }));
    const created = await createRegistration(env.DB, {
      event,
      userId: "movement-attendee",
      attendanceType: "in_person",
      dayAttendance,
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: created.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const initialStatsResponse = await callAdmin("/api/v1/events/pqc-2026/analytics");
    expect(initialStatsResponse.status).toBe(200);
    const initialStats = (await initialStatsResponse.json()) as {
      attendanceChanges: { changedAttendees: number; dayChanges: number };
    };
    expect(initialStats.attendanceChanges).toMatchObject({ changedAttendees: 0, dayChanges: 0 });

    await updateRegistrationById(
      env.DB,
      {
        eventId: event.id,
        registrationId: created.registration.id,
        action: "update",
        attendanceType: "virtual",
        dayAttendance: dayAttendance.map((entry) => ({ ...entry, attendanceType: "virtual" as const })),
        waitlistClaimWindowHours: 24,
      },
      "admin:test",
    );

    const statsResponse = await callAdmin("/api/v1/events/pqc-2026/analytics");
    expect(statsResponse.status).toBe(200);
    const stats = (await statsResponse.json()) as {
      attendanceChanges: {
        changedAttendees: number;
        dayChanges: number;
        leftInPersonAttendees: number;
        leftInPersonDayChanges: number;
        joinedInPersonAttendees: number;
        byTransition: Array<{ from_type: string; to_type: string; attendees: number; day_changes: number }>;
        byDay: Array<{
          day_date: string;
          changed_attendees: number;
          left_in_person_attendees: number;
          day_changes: number;
        }>;
        recent: Array<{ registration_id: string; days: Array<{ day_date: string }> }>;
      };
    };

    expect(stats.attendanceChanges).toMatchObject({
      changedAttendees: 1,
      dayChanges: 3,
      leftInPersonAttendees: 1,
      leftInPersonDayChanges: 3,
      joinedInPersonAttendees: 0,
    });
    expect(stats.attendanceChanges.byTransition).toEqual([
      { from_type: "in_person", to_type: "virtual", attendees: 1, day_changes: 3 },
    ]);
    expect(stats.attendanceChanges.byDay).toHaveLength(3);
    expect(stats.attendanceChanges.byDay).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          day_date: "2026-12-01",
          changed_attendees: 1,
          left_in_person_attendees: 1,
          day_changes: 1,
        }),
      ]),
    );
    expect(stats.attendanceChanges.recent).toHaveLength(1);
    expect(stats.attendanceChanges.recent[0]).toMatchObject({ registration_id: created.registration.id });
    expect(stats.attendanceChanges.recent[0].days).toHaveLength(3);

    const leftInPersonResponse = await callAdmin(
      "/api/v1/admin/events/pqc-2026/registrations?attendance_change=left_in_person",
    );
    expect(leftInPersonResponse.status).toBe(200);
    const leftInPerson = (await leftInPersonResponse.json()) as {
      registrations: Array<{
        id: string;
        lastAttendanceChange: {
          changedAt: string;
          transitions: Array<{
            fromType: string;
            toType: string;
            days: Array<{ dayDate: string }>;
          }>;
        };
      }>;
      page: { total: number };
    };
    expect(leftInPerson.page.total).toBe(1);
    expect(leftInPerson.registrations[0]).toMatchObject({ id: created.registration.id });
    expect(leftInPerson.registrations[0].lastAttendanceChange.transitions).toEqual([
      expect.objectContaining({ fromType: "in_person", toType: "virtual" }),
    ]);
    expect(leftInPerson.registrations[0].lastAttendanceChange.transitions[0].days).toHaveLength(3);

    const joinedInPersonResponse = await callAdmin(
      "/api/v1/admin/events/pqc-2026/registrations?attendance_change=joined_in_person",
    );
    const joinedInPerson = (await joinedInPersonResponse.json()) as { page: { total: number } };
    expect(joinedInPerson.page.total).toBe(0);

    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
       VALUES ('movement-later', 'movement-later@example.test', 'movement-later@example.test',
               'Later', 'Movement', datetime('now'), datetime('now'))`,
    ).run();
    const later = await createRegistration(env.DB, {
      event,
      userId: "movement-later",
      attendanceType: "in_person",
      dayAttendance,
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await env.DB.prepare(
      "UPDATE registration_attendance_history SET changed_at = '2025-01-01T00:00:00.000Z' WHERE registration_id = ?",
    )
      .bind(created.registration.id)
      .run();
    await updateRegistrationById(
      env.DB,
      {
        eventId: event.id,
        registrationId: later.registration.id,
        action: "update",
        attendanceType: "virtual",
        dayAttendance: dayAttendance.map((entry) => ({ ...entry, attendanceType: "virtual" as const })),
        waitlistClaimWindowHours: 24,
      },
      "admin:test",
    );
    await updateRegistrationById(
      env.DB,
      {
        eventId: event.id,
        registrationId: created.registration.id,
        action: "update",
        attendanceType: "on_demand",
        dayAttendance: dayAttendance.map((entry) => ({ ...entry, attendanceType: "on_demand" as const })),
        waitlistClaimWindowHours: 24,
      },
      "admin:test",
    );
    await env.DB.prepare(
      `UPDATE registration_attendance_history
       SET changed_at = '2030-01-01T00:00:00.000Z'
       WHERE registration_id = ? AND from_type = 'virtual' AND to_type = 'on_demand'`,
    )
      .bind(created.registration.id)
      .run();

    const recentlyChangedResponse = await callAdmin(
      "/api/v1/admin/events/pqc-2026/registrations?attendance_change=any",
    );
    const recentlyChanged = (await recentlyChangedResponse.json()) as {
      registrations: Array<{
        id: string;
        attendanceChangeHistory: Array<{
          changedAt: string;
          transitions: Array<{ fromType: string; toType: string }>;
        }>;
        lastAttendanceChange: { changedAt: string };
      }>;
      page: { total: number };
    };
    expect(recentlyChanged.page.total).toBe(2);
    expect(recentlyChanged.registrations.map((registration) => registration.id)).toEqual([
      created.registration.id,
      later.registration.id,
    ]);
    expect(recentlyChanged.registrations[0].attendanceChangeHistory).toHaveLength(2);
    expect(
      recentlyChanged.registrations[0].attendanceChangeHistory.map((change) =>
        change.transitions.map((transition) => `${transition.fromType}->${transition.toType}`),
      ),
    ).toEqual([["in_person->virtual"], ["virtual->on_demand"]]);
    expect(recentlyChanged.registrations[0].lastAttendanceChange.changedAt).toBe("2030-01-01T00:00:00.000Z");

    const invalidFilterResponse = await callAdmin(
      "/api/v1/admin/events/pqc-2026/registrations?attendance_change=unexpected",
    );
    expect(invalidFilterResponse.status).toBe(400);
    const invalidFilter = (await invalidFilterResponse.json()) as { error: { code: string } };
    expect(invalidFilter.error.code).toBe("VALIDATION_ERROR");
  });

  it("bounds the registrations list via limit/offset with a real COUNT-based hasMore, not a limit+1 slice", async () => {
    await setupAdmin();
    const event = await getEventBySlug(env.DB, "pqc-2026");

    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
       VALUES
         ('bounded-a', 'bounded-a@example.test', 'bounded-a@example.test', 'A', 'Attendee', datetime('now'), datetime('now')),
         ('bounded-b', 'bounded-b@example.test', 'bounded-b@example.test', 'B', 'Attendee', datetime('now'), datetime('now')),
         ('bounded-c', 'bounded-c@example.test', 'bounded-c@example.test', 'C', 'Attendee', datetime('now'), datetime('now'))`,
    ).run();

    for (const userId of ["bounded-a", "bounded-b", "bounded-c"]) {
      const registration = await createRegistration(env.DB, {
        event,
        userId,
        attendanceType: "virtual",
        sourceType: "direct",
        confirmationTtlHours: 48,
        signingSecret: "test-signing-secret",
      });
      await confirmRegistrationByToken(env.DB, {
        token: registration.confirmationToken as string,
        waitlistClaimWindowHours: 24,
        signingSecret: "test-signing-secret",
      });
    }

    type ListResponse = {
      registrations: Array<{ id: string }>;
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };

    const page1Res = await callAdmin("/api/v1/admin/events/pqc-2026/registrations?limit=2&offset=0");
    expect(page1Res.status).toBe(200);
    const page1 = (await page1Res.json()) as ListResponse;
    expect(page1.registrations).toHaveLength(2);
    expect(page1.page).toEqual({ limit: 2, offset: 0, total: 3, hasMore: true });

    const page2Res = await callAdmin("/api/v1/admin/events/pqc-2026/registrations?limit=2&offset=2");
    expect(page2Res.status).toBe(200);
    const page2 = (await page2Res.json()) as ListResponse;
    expect(page2.registrations).toHaveLength(1);
    expect(page2.page).toEqual({ limit: 2, offset: 2, total: 3, hasMore: false });

    const ids = new Set([...page1.registrations, ...page2.registrations].map((r) => r.id));
    expect(ids.size).toBe(3);

    const invalidLimitRes = await callAdmin("/api/v1/admin/events/pqc-2026/registrations?limit=not-a-number");
    expect(invalidLimitRes.status).toBe(400);
  });

  // PR #1 review Phase 4 item 1: bare GET/POST /admin/events previously had
  // no permission check at all beyond bare authentication. Both routes are now
  // retired. The canonical collection is auth-aware instead of permission-
  // gated: a staff actor without events:read still sees the events their
  // audience allows, but only through the reduced projection.
  it("gives a staff user without events:read the reduced projection, and no retired creation route", async () => {
    await setupAdmin();
    const staffId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'no-events-perm@example.test', 'no-events-perm@example.test', 'user', 1, datetime('now'), datetime('now'))`,
    )
      .bind(staffId)
      .run();
    // Grants a role unrelated to events so the user passes
    // STAFF_ACCESS_CONDITION (can obtain a session at all).
    await env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'role-membership_processor', NULL, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffId)
      .run();
    const staffToken = await createAdminSession(env.DB, staffId, "no-events-perm-token");
    const asStaff = (path: string, init: RequestInit = {}) =>
      app.fetch(
        new Request(`https://app.test${path}`, {
          ...init,
          headers: { "content-type": "application/json", authorization: `Bearer ${staffToken}`, ...init.headers },
        }),
        env as any,
        { passThroughOnException: () => {}, waitUntil: () => {} } as any,
      );

    // The retired ownerless creation route no longer exists at all.
    expect(
      (
        await asStaff("/api/v1/admin/events", {
          method: "POST",
          body: JSON.stringify({ slug: "should-not-be-created", name: "Should Not Be Created", timezone: "UTC" }),
        })
      ).status,
    ).toBe(404);

    // Importing requires events:write, which this user does not hold.
    expect(
      (
        await asStaff("/api/v1/events/imports", {
          method: "POST",
          body: JSON.stringify({ source: "hugo", event: { slug: "nope", name: "Nope", timezone: "UTC" } }),
        })
      ).status,
    ).toBe(403);

    // The collection itself is readable, but only in the reduced projection.
    const listResponse = await asStaff("/api/v1/events");
    expect(listResponse.status).toBe(200);
    const payload = (await listResponse.json()) as { events: Array<Record<string, unknown>> };
    for (const event of payload.events) {
      expect(event.totalRegistrations).toBeUndefined();
      expect(event.sourcePath).toBeUndefined();
      expect(event.accessLevel).toBeDefined();
    }
  });
});
