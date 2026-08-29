import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import {
  eventDetailResponseSchema,
  eventManagementDetailResponseSchema,
  eventsListQuerySchema,
  eventsListResponseSchema,
} from "../assets/shared/schemas/event-management";
import type { EventVisibility } from "../assets/shared/schemas/event-series";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { buildEventsPageQuery } from "../functions/_lib/services/events/catalog";
import { createGroup, joinGroup } from "../functions/_lib/services/groups";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { insertOrgRepresentative } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function request(path: string, token?: string): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    }),
    env,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function insertEvent(slug: string, visibility: EventVisibility, ownerGroupId: string | null = null) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO events
       (id, slug, name, timezone, starts_at, ends_at, registration_mode, visibility,
        settings_json, links_json, owner_group_id, profile_key, source_mode, created_at, updated_at)
     VALUES (?, ?, ?, 'UTC', '2027-01-01T10:00:00.000Z', '2027-01-01T12:00:00.000Z',
             'optional', ?, ?, ?, ?, 'workshop', ?, datetime('now'), datetime('now'))`,
  )
    .bind(
      id,
      slug,
      `${slug} event`,
      visibility,
      JSON.stringify({
        location: "Published room",
        virtualUrl: "https://secret.example.test/join",
        internal: "secret",
      }),
      JSON.stringify(["https://example.test/event"]),
      ownerGroupId,
      ownerGroupId ? "portal" : "integration",
    )
    .run();
  return id;
}

describe("event audience visibility", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("filters rows in D1 and projects fields according to the caller's live audience", async () => {
    const adminUserId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'event-visibility-admin@example.test', 'event-visibility-admin@example.test', 'admin', 1,
               datetime('now'), datetime('now'))`,
    )
      .bind(adminUserId)
      .run();
    const admin: UserBackedAuthAdmin = {
      identityType: "user",
      id: adminUserId,
      email: "event-visibility-admin@example.test",
      role: "admin",
    };
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Visibility group ${crypto.randomUUID()}`,
      visibility: "participants",
      eligibilityMode: "open",
    });
    const member = await insertOrgRepresentative(env.DB, {
      category: "A",
      email: `event-visibility-member-${crypto.randomUUID()}@example.test`,
    });
    const memberToken = await createMemberSession(env.DB, member.userId, `event-visibility-${crypto.randomUUID()}`);
    const publicEventId = await insertEvent("public-event", "public");
    await insertEvent("all-member-event", "all_members");
    await insertEvent("group-event", "group_members", group.id);
    const invitationEventId = await insertEvent("invitation-event", "invitation_only");

    const anonymousList = eventsListResponseSchema.parse(await (await request("/api/v1/events")).json());
    expect(anonymousList.events.map((event) => event.slug)).toEqual(["public-event"]);
    expect(anonymousList.page.total).toBe(1);

    const publicDetailResponse = await request("/api/v1/events/public-event");
    expect(publicDetailResponse.status).toBe(200);
    const publicDetail = eventDetailResponseSchema.parse(await publicDetailResponse.json()).event;
    expect(publicDetail).toMatchObject({ slug: "public-event", accessLevel: "public", visibility: "public" });
    expect(publicDetail).not.toHaveProperty("settings");
    expect(publicDetail).not.toHaveProperty("virtualUrl");
    expect(publicDetail).not.toHaveProperty("inviteLimitAttendee");
    expect(publicDetail).not.toHaveProperty("updatedAt");
    expect((await request("/api/v1/events/invitation-event")).status).toBe(404);

    const memberListBeforeJoin = eventsListResponseSchema.parse(
      await (await request("/api/v1/events", memberToken)).json(),
    );
    expect(memberListBeforeJoin.events.map((event) => event.slug).sort()).toEqual(["all-member-event", "public-event"]);

    await joinGroup(env.DB, group.id, {
      actorUserId: member.userId,
      targetUserId: member.userId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });
    const memberListAfterJoin = eventsListResponseSchema.parse(
      await (await request("/api/v1/events", memberToken)).json(),
    );
    expect(memberListAfterJoin.events.map((event) => event.slug).sort()).toEqual([
      "all-member-event",
      "group-event",
      "public-event",
    ]);

    await env.DB.prepare(
      `INSERT INTO invites
         (id, event_id, invitee_email, invite_type, link_secret, status, expires_at, created_at)
       SELECT ?, ?, normalized_email, 'attendee', ?, 'sent', '2027-01-01T10:00:00.000Z', datetime('now')
         FROM users WHERE id = ?`,
    )
      .bind(crypto.randomUUID(), invitationEventId, crypto.randomUUID(), member.userId)
      .run();
    const invitedList = eventsListResponseSchema.parse(await (await request("/api/v1/events", memberToken)).json());
    expect(invitedList.events.map((event) => event.slug).sort()).toEqual([
      "all-member-event",
      "group-event",
      "invitation-event",
      "public-event",
    ]);
    expect(invitedList.page.total).toBe(4);

    const adminToken = await createAdminSession(env.DB, adminUserId, `event-visibility-admin-${crypto.randomUUID()}`);
    const management = eventManagementDetailResponseSchema.parse(
      await (await request("/api/v1/events/public-event", adminToken)).json(),
    ).event;
    expect(management.id).toBe(publicEventId);
    expect(management.settings).toMatchObject({ internal: "secret" });
    expect(management.virtualUrl).toBe("https://secret.example.test/join");

    const visibilityUpdate = await app.fetch(
      new Request("https://app.test/api/v1/events/public-event/settings", {
        method: "PATCH",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: management.updatedAt, visibility: "invitation_only" }),
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(visibilityUpdate.status, await visibilityUpdate.clone().text()).toBe(200);
    expect(eventManagementDetailResponseSchema.parse(await visibilityUpdate.json()).event.visibility).toBe(
      "invitation_only",
    );
    expect((await request("/api/v1/events/public-event")).status).toBe(404);
    expect(
      eventsListResponseSchema.parse(await (await request("/api/v1/events")).json()).events.map((event) => event.slug),
    ).not.toContain("public-event");
  });

  it("does not downgrade an invalid credential to anonymous public access", async () => {
    await insertEvent("public-event", "public");
    const response = await request("/api/v1/events/public-event", "not-a-user-session");
    expect(response.status).toBe(401);
  });

  it("uses the visibility schedule index for anonymous page and count queries", async () => {
    const query = buildEventsPageQuery(
      { userId: null, canReadAll: false },
      eventsListQuerySchema.parse({ limit: 25, offset: 0 }),
    );
    const { pageSql, countSql, bindings, countBindings } = buildOffsetPageSql(query);
    const [pagePlan, countPlan] = await Promise.all([
      env.DB.prepare(`EXPLAIN QUERY PLAN ${pageSql}`)
        .bind(...bindings, query.limit, query.offset)
        .all<{ detail: string }>(),
      env.DB.prepare(`EXPLAIN QUERY PLAN ${countSql}`)
        .bind(...countBindings)
        .all<{ detail: string }>(),
    ]);
    for (const plan of [pagePlan, countPlan]) {
      const details = plan.results.map((row) => row.detail).join("\n");
      expect(details).toContain("idx_events_visibility_schedule");
      expect(details).not.toContain("SCAN event");
    }
  });
});
