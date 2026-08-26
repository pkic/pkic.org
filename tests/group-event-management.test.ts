import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { groupEventsListQuerySchema } from "../assets/shared/schemas/group-events";
import {
  createGroupManagedEvent,
  listGroupManagedEventRegistrations,
  updateGroupManagedEventSettings,
} from "../functions/_lib/services/events/group-management";
import { getGroupEvent, listGroupEvents } from "../functions/_lib/services/events/group-read-model";
import { createGroup } from "../functions/_lib/services/groups";
import { grantResourceToGroup } from "../functions/_lib/services/resource-grants";
import type { DatabaseLike, UserBackedAuthAdmin } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { mutateBeforeNextBatch, mutateBeforeNextStatement } from "./helpers/database-races";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

interface Fixture {
  administrator: UserBackedAuthAdmin;
  ownerGroupId: string;
  granteeGroupId: string;
  ownerLeader: UserBackedAuthAdmin;
  granteeLeader: UserBackedAuthAdmin;
  ownerLeaderToken: string;
  granteeLeaderToken: string;
}

async function userActor(label: string, role = "user"): Promise<UserBackedAuthAdmin> {
  const email = `${label}-${crypto.randomUUID()}@example.test`;
  const id = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  return { identityType: "user", id, email, role };
}

async function assignGroupLead(userId: string, groupId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_roles
         (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
       VALUES (?, ?, 'role-group_lead', 'group', ?, 0, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), userId, groupId)
    .run();
}

async function createFixture(): Promise<Fixture> {
  const administrator = await userActor("group-event-administrator", "admin");
  const [ownerGroup, granteeGroup] = await Promise.all(
    ["owner", "grantee"].map((suffix) =>
      createGroup(env.DB, administrator, {
        typeKey: "working_group",
        name: `Event ${suffix} ${crypto.randomUUID()}`,
        visibility: "authenticated",
        eligibilityMode: "open",
      }),
    ),
  );
  const ownerLeader = await userActor("group-event-owner-leader");
  const granteeLeader = await userActor("group-event-grantee-leader");
  await Promise.all([
    assignGroupLead(ownerLeader.id, ownerGroup.id),
    assignGroupLead(granteeLeader.id, granteeGroup.id),
  ]);
  return {
    administrator,
    ownerGroupId: ownerGroup.id,
    granteeGroupId: granteeGroup.id,
    ownerLeader,
    granteeLeader,
    ownerLeaderToken: await createAdminSession(env.DB, ownerLeader.id, `owner-leader-${crypto.randomUUID()}`),
    granteeLeaderToken: await createAdminSession(env.DB, granteeLeader.id, `grantee-leader-${crypto.randomUUID()}`),
  };
}

function request(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return callApi(env, path, { ...init, headers });
}

async function createGroupEvent(fixture: Fixture): Promise<{ id: string; updatedAt: string }> {
  const response = await request(fixture.ownerLeaderToken, `/api/v1/groups/${fixture.ownerGroupId}/events`, {
    method: "POST",
    body: JSON.stringify({
      slug: `group-workshop-${crypto.randomUUID()}`,
      name: "Group workshop",
      timezone: "Europe/Amsterdam",
      startsAt: "2027-04-12T08:00:00.000Z",
      endsAt: "2027-04-12T17:00:00.000Z",
      profileKey: "workshop",
      registrationPolicy: "no_registration",
      location: "Online",
      links: ["https://example.test/register"],
    }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const body = (await response.json()) as {
    event: { id: string; updatedAt: string; sourceMode: string; location: string; capabilities: string[] };
  };
  expect(body.event).toMatchObject({ sourceMode: "portal", location: "Online" });
  expect(body.event.capabilities).not.toContain("register");
  return body.event;
}

beforeEach(resetDb);

describe("group event management routes", () => {
  it("creates, updates, and lists attendees through the selected owner group", async () => {
    const fixture = await createFixture();
    const created = await createGroupEvent(fixture);

    const update = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/settings`,
      {
        method: "PATCH",
        body: JSON.stringify({
          expectedUpdatedAt: created.updatedAt,
          location: "Hybrid",
          links: ["https://example.test/register", "https://example.test/agenda"],
        }),
      },
    );
    expect(update.status, await update.clone().text()).toBe(200);
    expect(await update.json()).toMatchObject({
      event: {
        id: created.id,
        registrationPolicy: "no_registration",
        location: "Hybrid",
        links: ["https://example.test/register", "https://example.test/agenda"],
      },
    });

    const auditBeforeStaleUpdate = await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_id = ?")
      .bind(created.id)
      .first<{ count: number }>();
    const staleUpdate = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/settings`,
      {
        method: "PATCH",
        body: JSON.stringify({ expectedUpdatedAt: created.updatedAt, name: "Stale overwrite" }),
      },
    );
    expect(staleUpdate.status, await staleUpdate.clone().text()).toBe(409);
    expect(await staleUpdate.json()).toMatchObject({ error: { code: "GROUP_EVENT_CHANGED" } });
    expect(await env.DB.prepare("SELECT name FROM events WHERE id = ?").bind(created.id).first()).toMatchObject({
      name: "Group workshop",
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_id = ?")
        .bind(created.id)
        .first<{ count: number }>(),
    ).toEqual(auditBeforeStaleUpdate);

    const attendeeId = crypto.randomUUID();
    const attendeeUserId = await insertUser(env.DB, "group-event-attendee@example.test");
    await env.DB.prepare(
      `INSERT INTO registrations
           (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
         VALUES (?, ?, ?, 'registered', 'in_person', 'direct', ?, datetime('now'), datetime('now'))`,
    )
      .bind(attendeeId, created.id, attendeeUserId, `manage-${crypto.randomUUID()}`)
      .run();

    const attendees = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/registrations?q=group-event-attendee&limit=1`,
    );
    expect(attendees.status, await attendees.clone().text()).toBe(200);
    expect(await attendees.json()).toMatchObject({
      registrations: [{ id: attendeeId, user_email: "group-event-attendee@example.test" }],
      page: { limit: 1, total: 1, hasMore: false },
    });
  });

  it("allows an explicitly delegated manage capability but not another group leader", async () => {
    const fixture = await createFixture();
    const created = await createGroupEvent(fixture);

    const denied = await request(
      fixture.granteeLeaderToken,
      `/api/v1/groups/${fixture.granteeGroupId}/events/${created.id}/settings`,
      { method: "PATCH", body: JSON.stringify({ expectedUpdatedAt: created.updatedAt, name: "Denied" }) },
    );
    expect(denied.status).toBe(403);

    await grantResourceToGroup(env.DB, fixture.administrator, fixture.ownerGroupId, "event", created.id, {
      granteeGroupId: fixture.granteeGroupId,
      capability: "manage",
    });
    const delegated = await request(
      fixture.granteeLeaderToken,
      `/api/v1/groups/${fixture.granteeGroupId}/events/${created.id}/settings`,
      { method: "PATCH", body: JSON.stringify({ expectedUpdatedAt: created.updatedAt, name: "Delegated update" }) },
    );
    expect(delegated.status, await delegated.clone().text()).toBe(200);
    expect(await delegated.json()).toMatchObject({ event: { name: "Delegated update" } });
  });

  it("does not expose list or detail data after management access is revoked before the read", async () => {
    const fixture = await createFixture();
    const created = await createGroupEvent(fixture);
    const viewer = { userId: fixture.ownerLeader.id, admin: fixture.ownerLeader };
    const query = groupEventsListQuerySchema.parse({ limit: 20 });

    const list = await listGroupEvents(
      mutateBeforeNextBatch(env.DB, async () => {
        await env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE user_id = ?")
          .bind(fixture.ownerLeader.id)
          .run();
      }),
      viewer,
      fixture.ownerGroupId,
      query,
    );
    expect(list).toEqual({ events: [], total: 0 });

    await env.DB.prepare("UPDATE user_roles SET revoked_at = NULL WHERE user_id = ?")
      .bind(fixture.ownerLeader.id)
      .run();
    await expect(
      getGroupEvent(
        mutateBeforeNextStatement(env.DB, async () => {
          await env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE user_id = ?")
            .bind(fixture.ownerLeader.id)
            .run();
        }),
        viewer,
        fixture.ownerGroupId,
        created.id,
      ),
    ).rejects.toMatchObject({ code: "EVENT_NOT_FOUND" });
  });

  it("rejects meeting profiles from standalone event creation", async () => {
    const fixture = await createFixture();
    const response = await request(fixture.ownerLeaderToken, `/api/v1/groups/${fixture.ownerGroupId}/events`, {
      method: "POST",
      body: JSON.stringify({
        slug: `invalid-meeting-${crypto.randomUUID()}`,
        name: "This must be a meeting series",
        profileKey: "meeting",
      }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects standalone settings updates for meeting-profile and series-owned events", async () => {
    const fixture = await createFixture();
    const profileManaged = await createGroupEvent(fixture);
    await env.DB.prepare("UPDATE events SET profile_key = 'meeting' WHERE id = ?").bind(profileManaged.id).run();

    const profileUpdate = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${profileManaged.id}/settings`,
      {
        method: "PATCH",
        body: JSON.stringify({ expectedUpdatedAt: profileManaged.updatedAt, name: "Wrong settings path" }),
      },
    );
    expect(profileUpdate.status, await profileUpdate.clone().text()).toBe(409);
    expect(await profileUpdate.json()).toMatchObject({ error: { code: "EVENT_MANAGED_BY_MEETING_SERIES" } });

    const seriesManaged = await createGroupEvent(fixture);
    await env.DB.prepare(
      `INSERT INTO event_series
         (id, event_id, starts_at, recurrence_rule, timezone, duration_minutes, active, created_at, updated_at)
       VALUES (?, ?, ?, 'FREQ=WEEKLY', 'UTC', 60, 1, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), seriesManaged.id, "2027-04-12T08:00:00.000Z")
      .run();

    const seriesUpdate = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${seriesManaged.id}/settings`,
      {
        method: "PATCH",
        body: JSON.stringify({ expectedUpdatedAt: seriesManaged.updatedAt, name: "Wrong settings path" }),
      },
    );
    expect(seriesUpdate.status, await seriesUpdate.clone().text()).toBe(409);
    expect(await seriesUpdate.json()).toMatchObject({ error: { code: "EVENT_MANAGED_BY_MEETING_SERIES" } });
  });

  it("serves only active event profiles and keeps meeting profiles series-only", async () => {
    const fixture = await createFixture();
    await env.DB.prepare("UPDATE event_profiles SET active = 0 WHERE key = 'tutorial'").run();
    const response = await request(fixture.ownerLeaderToken, `/api/v1/groups/${fixture.ownerGroupId}/events/profiles`);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({
      profiles: [
        {
          key: "meeting",
          label: "Meeting",
          description: "A recurring or one-off group meeting.",
          standaloneEligible: false,
        },
        {
          key: "board_meeting",
          label: "Board Meeting",
          description: "A meeting for a governing group.",
          standaloneEligible: false,
        },
        {
          key: "conference",
          label: "Conference",
          description: "A multi-session conference.",
          standaloneEligible: true,
        },
        {
          key: "workshop",
          label: "Workshop",
          description: "An interactive workshop that may permit public registration.",
          standaloneEligible: true,
        },
      ],
    });

    const staleChoice = await request(fixture.ownerLeaderToken, `/api/v1/groups/${fixture.ownerGroupId}/events`, {
      method: "POST",
      body: JSON.stringify({
        slug: `stale-profile-${crypto.randomUUID()}`,
        name: "Stale profile choice",
        profileKey: "tutorial",
      }),
    });
    expect(staleChoice.status, await staleChoice.clone().text()).toBe(409);
    expect(await staleChoice.json()).toMatchObject({
      error: { code: "GROUP_EVENT_CREATE_AUTHORIZATION_CHANGED" },
    });
  });

  it("does not leak attendees to view/register grants and aborts a read when authority changes", async () => {
    const fixture = await createFixture();
    const created = await createGroupEvent(fixture);
    for (const capability of ["view", "register"] as const) {
      await grantResourceToGroup(env.DB, fixture.administrator, fixture.ownerGroupId, "event", created.id, {
        granteeGroupId: fixture.granteeGroupId,
        capability,
      });
    }
    const denied = await request(
      fixture.granteeLeaderToken,
      `/api/v1/groups/${fixture.granteeGroupId}/events/${created.id}/registrations`,
    );
    expect(denied.status).toBe(403);

    await grantResourceToGroup(env.DB, fixture.administrator, fixture.ownerGroupId, "event", created.id, {
      granteeGroupId: fixture.granteeGroupId,
      capability: "manage_attendance",
    });
    await expect(
      listGroupManagedEventRegistrations(
        mutateBeforeNextBatch(env.DB, async () => {
          await env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE user_id = ?")
            .bind(fixture.granteeLeader.id)
            .run();
        }),
        fixture.granteeLeader,
        fixture.granteeGroupId,
        created.id,
        { limit: 10, offset: 0 },
      ),
    ).rejects.toMatchObject({ code: "EVENT_ATTENDANCE_MANAGEMENT_CONTEXT_CHANGED" });
  });

  it("rolls back creation and update when live profile or leadership authorization changes", async () => {
    const fixture = await createFixture();
    const beforeEvents = await env.DB.prepare("SELECT COUNT(*) AS count FROM events").first<{ count: number }>();
    await expect(
      createGroupManagedEventForRace(
        fixture,
        mutateBeforeNextBatch(env.DB, async () => {
          await env.DB.prepare("UPDATE event_profiles SET active = 0 WHERE key = 'workshop'").run();
        }),
      ),
    ).rejects.toMatchObject({ code: "GROUP_EVENT_CREATE_AUTHORIZATION_CHANGED" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM events").first<{ count: number }>()).toEqual(
      beforeEvents,
    );

    await env.DB.prepare("UPDATE event_profiles SET active = 1 WHERE key = 'workshop'").run();
    const created = await createGroupEvent(fixture);
    await expect(
      updateGroupManagedEventSettings(
        mutateBeforeNextBatch(env.DB, async () => {
          await env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE user_id = ?")
            .bind(fixture.ownerLeader.id)
            .run();
        }),
        fixture.ownerLeader,
        fixture.ownerGroupId,
        created.id,
        { expectedUpdatedAt: created.updatedAt, name: "Must not save" },
        "https://app.test",
      ),
    ).rejects.toMatchObject({ code: "EVENT_MANAGEMENT_CONTEXT_CHANGED" });
    expect(
      await env.DB.prepare("SELECT name FROM events WHERE id = ?").bind(created.id).first<{ name: string }>(),
    ).toEqual({
      name: "Group workshop",
    });

    await env.DB.prepare("UPDATE user_roles SET revoked_at = NULL WHERE user_id = ?")
      .bind(fixture.ownerLeader.id)
      .run();
    await expect(
      updateGroupManagedEventSettings(
        mutateBeforeNextBatch(env.DB, async () => {
          await env.DB.prepare(
            `INSERT INTO event_series
               (id, event_id, starts_at, recurrence_rule, timezone, duration_minutes, active, created_at, updated_at)
             VALUES (?, ?, ?, 'FREQ=WEEKLY', 'UTC', 60, 1, datetime('now'), datetime('now'))`,
          )
            .bind(crypto.randomUUID(), created.id, "2027-04-12T08:00:00.000Z")
            .run();
        }),
        fixture.ownerLeader,
        fixture.ownerGroupId,
        created.id,
        { expectedUpdatedAt: created.updatedAt, name: "Must still not save" },
        "https://app.test",
      ),
    ).rejects.toMatchObject({ code: "EVENT_MANAGED_BY_MEETING_SERIES" });
    expect(
      await env.DB.prepare("SELECT name FROM events WHERE id = ?").bind(created.id).first<{ name: string }>(),
    ).toEqual({
      name: "Group workshop",
    });
  });
});

async function createGroupManagedEventForRace(fixture: Fixture, db: DatabaseLike): Promise<{ eventId: string }> {
  return createGroupManagedEvent(db, fixture.ownerLeader, fixture.ownerGroupId, {
    slug: `group-race-${crypto.randomUUID()}`,
    name: "Profile race",
    timezone: "UTC",
    profileKey: "workshop",
    registrationPolicy: "no_registration",
    inviteLimitAttendee: 5,
  });
}
