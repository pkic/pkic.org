import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { groupEventsListQuerySchema } from "../assets/shared/schemas/group-events";
import {
  createGroupManagedEvent,
  listGroupManagedEventRegistrations,
  updateGroupManagedEventSettings,
} from "../functions/_lib/services/events/group-management";
import {
  replaceGroupManagedEventDays,
  replaceGroupManagedEventTerms,
} from "../functions/_lib/services/events/group-configuration";
import { replaceGroupEventRegistrationSettings } from "../functions/_lib/services/events/registration-settings";
import { getGroupEvent, listGroupEvents } from "../functions/_lib/services/events/group-read-model";
import { CONFIGURED_EVENT_DAY_ATTENDANCE_COUNTS_SQL } from "../functions/_lib/services/event-days";
import {
  createManagedFormPlacement,
  getActiveFormForEvent,
  updateGroupFormPlacement,
  validateCustomAnswersForSubmission,
} from "../functions/_lib/services/forms";
import { replaceGroupEventForm } from "../functions/_lib/services/events/form-placement";
import { createGroup } from "../functions/_lib/services/groups";
import { grantResourceToGroup } from "../functions/_lib/services/resource-grants";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../functions/_lib/types";
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

/** Runs a permitted placement move after registration settings read its current placement. */
function movePlacementAfterRead(db: DatabaseLike, mutation: () => Promise<unknown>): DatabaseLike {
  let moved = false;
  const wrap = (sql: string, statement: StatementLike) => {
    const wrapBound = (bound: StatementLike): StatementLike => ({
      bind(...values: unknown[]) {
        return wrapBound(bound.bind(...values));
      },
      async run<T = Record<string, unknown>>() {
        return bound.run<T>();
      },
      async all<T = Record<string, unknown>>() {
        const result = await bound.all<T>();
        if (!moved && sql.includes("ORDER BY placement.created_at ASC")) {
          moved = true;
          await mutation();
        }
        return result;
      },
      async first<T = Record<string, unknown>>(columnName?: string) {
        return bound.first<T>(columnName);
      },
    });
    return wrapBound(statement);
  };
  return {
    prepare: (sql: string) =>
      sql.includes("ORDER BY placement.created_at ASC") ? wrap(sql, db.prepare(sql)) : db.prepare(sql),
    batch: (statements) => db.batch(statements),
  };
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
      inviteLimitAttendee: 5,
      location: "Online",
      links: ["https://example.test/register"],
    }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const body = (await response.json()) as {
    event: {
      id: string;
      updatedAt: string;
      sourceMode: string;
      inviteLimitAttendee: number;
      location: string;
      capabilities: string[];
    };
  };
  expect(body.event).toMatchObject({ sourceMode: "portal", inviteLimitAttendee: 5, location: "Online" });
  expect(body.event.capabilities).not.toContain("register");
  return body.event;
}

beforeEach(resetDb);

describe("group event management routes", () => {
  it("uses indexed D1 joins for event-day attendance counts", async () => {
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${CONFIGURED_EVENT_DAY_ATTENDANCE_COUNTS_SQL}`)
      .bind("event-id")
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");
    expect(details).toContain("idx_registrations_event_status_created");
    expect(details).toContain("sqlite_autoindex_registration_day_attendance_2");
    expect(details).toContain("sqlite_autoindex_event_days_1");
    expect(details).not.toContain("SCAN ");
  });

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
          inviteLimitAttendee: 0,
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
        inviteLimitAttendee: 0,
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

  it("configures terms and attendance days through one guarded selected-group contract", async () => {
    const fixture = await createFixture();
    const created = await createGroupEvent(fixture);
    const terms = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/terms`,
      {
        method: "PUT",
        body: JSON.stringify({
          expectedUpdatedAt: created.updatedAt,
          configuration: {
            attendee: [
              {
                termKey: "event-terms",
                version: "1.0",
                required: true,
                displayText: "I agree to the event terms",
                contentRef: "https://example.test/terms",
              },
            ],
            speaker: [],
            presentation: [],
          },
        }),
      },
    );
    expect(terms.status, await terms.clone().text()).toBe(200);
    const termsBody = (await terms.json()) as { success: boolean; eventUpdatedAt: string };
    expect(termsBody.success).toBe(true);
    expect(termsBody.eventUpdatedAt).not.toBe(created.updatedAt);
    const configuredTerms = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/terms`,
    );
    expect(configuredTerms.status, await configuredTerms.clone().text()).toBe(200);
    expect(((await configuredTerms.json()) as { terms: { attendee: unknown[] } }).terms.attendee).toEqual([
      expect.objectContaining({
        audience_type: "attendee",
        term_key: "event-terms",
        version: "1.0",
        required: 1,
        display_text: "I agree to the event terms",
      }),
    ]);

    const duplicateTerms = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/terms`,
      {
        method: "PUT",
        body: JSON.stringify({
          expectedUpdatedAt: termsBody.eventUpdatedAt,
          configuration: {
            attendee: [
              { termKey: "duplicate", version: "1", displayText: "First duplicate" },
              { termKey: "duplicate", version: "1", displayText: "Second duplicate" },
            ],
          },
        }),
      },
    );
    expect(duplicateTerms.status).toBe(400);

    const days = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/days`,
      {
        method: "PUT",
        body: JSON.stringify({
          expectedUpdatedAt: termsBody.eventUpdatedAt,
          configuration: {
            days: [
              {
                date: "2027-04-12",
                label: "Workshop day",
                startTime: "10:00",
                endTime: "17:00",
                sortOrder: 10,
                attendanceOptions: [
                  { value: "in_person", label: "In person", capacity: 25 },
                  { value: "virtual", label: "Virtual" },
                ],
              },
            ],
          },
        }),
      },
    );
    expect(days.status, await days.clone().text()).toBe(200);
    expect(await days.json()).toMatchObject({
      success: true,
      skipped: [],
    });
    const configuredDays = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/days`,
    );
    expect(configuredDays.status, await configuredDays.clone().text()).toBe(200);
    expect(await configuredDays.json()).toMatchObject({
      days: [
        {
          date: "2027-04-12",
          label: "Workshop day",
          sortOrder: 10,
          attendanceOptions: [
            { value: "in_person", label: "In person", capacity: 25 },
            { value: "virtual", label: "Virtual" },
          ],
          attendanceCounts: {},
        },
      ],
    });

    const audits = await env.DB.prepare(
      `SELECT action, scope_type, scope_id
         FROM audit_log
        WHERE entity_id = ? AND action IN ('event_terms_replaced', 'event_days_updated')
        ORDER BY created_at`,
    )
      .bind(created.id)
      .all<{ action: string; scope_type: string; scope_id: string }>();
    expect(audits.results).toEqual([
      { action: "event_terms_replaced", scope_type: "group", scope_id: fixture.ownerGroupId },
      { action: "event_days_updated", scope_type: "group", scope_id: fixture.ownerGroupId },
    ]);
  });

  it("requires manage capability for event configuration and honors an explicit delegated manager", async () => {
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
      `/api/v1/groups/${fixture.granteeGroupId}/events/${created.id}/terms`,
    );
    expect(denied.status).toBe(403);

    await grantResourceToGroup(env.DB, fixture.administrator, fixture.ownerGroupId, "event", created.id, {
      granteeGroupId: fixture.granteeGroupId,
      capability: "manage",
    });
    const delegated = await request(
      fixture.granteeLeaderToken,
      `/api/v1/groups/${fixture.granteeGroupId}/events/${created.id}/terms`,
      {
        method: "PUT",
        body: JSON.stringify({
          expectedUpdatedAt: created.updatedAt,
          configuration: {
            attendee: [{ termKey: "delegated", version: "1", displayText: "Delegated terms" }],
          },
        }),
      },
    );
    expect(delegated.status, await delegated.clone().text()).toBe(200);
    expect(await delegated.json()).toMatchObject({ success: true });
    const configured = await request(
      fixture.granteeLeaderToken,
      `/api/v1/groups/${fixture.granteeGroupId}/events/${created.id}/terms`,
    );
    expect(await configured.json()).toMatchObject({ terms: { attendee: [{ term_key: "delegated" }] } });
  });

  it("rolls back stale and concurrently unauthorized event configuration writes", async () => {
    const fixture = await createFixture();
    const created = await createGroupEvent(fixture);
    const first = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/terms`,
      {
        method: "PUT",
        body: JSON.stringify({
          expectedUpdatedAt: created.updatedAt,
          configuration: {
            attendee: [{ termKey: "current", version: "1", displayText: "Current terms" }],
          },
        }),
      },
    );
    expect(first.status, await first.clone().text()).toBe(200);

    const stale = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/days`,
      {
        method: "PUT",
        body: JSON.stringify({
          expectedUpdatedAt: created.updatedAt,
          configuration: { days: [{ date: "2027-04-12", attendanceOptions: [] }] },
        }),
      },
    );
    expect(stale.status, await stale.clone().text()).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "GROUP_EVENT_CHANGED" } });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM event_days WHERE event_id = ?").bind(created.id).first(),
    ).toEqual({ count: 0 });

    const latest = (await first.json()) as { eventUpdatedAt: string };
    await expect(
      replaceGroupManagedEventTerms(
        mutateBeforeNextBatch(env.DB, async () => {
          await env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE user_id = ?")
            .bind(fixture.ownerLeader.id)
            .run();
        }),
        fixture.ownerLeader,
        fixture.ownerGroupId,
        created.id,
        latest.eventUpdatedAt,
        {
          attendee: [{ termKey: "must-not-save", version: "1", required: true, displayText: "No" }],
          speaker: [],
          presentation: [],
        },
      ),
    ).rejects.toMatchObject({ code: "EVENT_MANAGEMENT_CONTEXT_CHANGED" });
    expect(
      await env.DB.prepare("SELECT term_key FROM event_terms WHERE event_id = ? AND active = 1").bind(created.id).all(),
    ).toMatchObject({ results: [{ term_key: "current" }] });
  });

  it("rolls back a day replacement if the event becomes series-managed before commit", async () => {
    const fixture = await createFixture();
    const created = await createGroupEvent(fixture);
    await expect(
      replaceGroupManagedEventDays(
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
        created.updatedAt,
        { days: [{ date: "2027-04-12", attendanceOptions: [] }] },
      ),
    ).rejects.toMatchObject({ code: "EVENT_MANAGED_BY_MEETING_SERIES" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM event_days WHERE event_id = ?").bind(created.id).first(),
    ).toEqual({ count: 0 });
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

  it("keeps registration disabled without a form, then creates an exact group-owned attendee placement", async () => {
    const fixture = await createFixture();
    const created = await createGroupEvent(fixture);

    const invalidPolicy = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/registration-settings`,
      {
        method: "PUT",
        body: JSON.stringify({ expectedUpdatedAt: created.updatedAt, registrationPolicy: "open" }),
      },
    );
    expect(invalidPolicy.status).toBe(400);

    const missingTerms = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/registration-settings`,
      {
        method: "PUT",
        body: JSON.stringify({ expectedUpdatedAt: created.updatedAt, registrationPolicy: "optional" }),
      },
    );
    expect(missingTerms.status, await missingTerms.clone().text()).toBe(422);

    await env.DB.prepare(
      `INSERT INTO event_terms
         (id, event_id, audience_type, term_key, version, required, content_ref, active, display_text, created_at)
       VALUES (?, ?, 'attendee', 'terms', '1', 1, 'https://example.test/terms', 1, 'I agree', datetime('now'))`,
    )
      .bind(crypto.randomUUID(), created.id)
      .run();

    const noForm = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/registration-settings`,
      {
        method: "PUT",
        body: JSON.stringify({ expectedUpdatedAt: created.updatedAt, registrationPolicy: "optional" }),
      },
    );
    expect(noForm.status, await noForm.clone().text()).toBe(200);
    const noFormBody = (await noForm.json()) as { eventUpdatedAt: string; registrationPolicy: string };
    expect(noFormBody).toEqual({ eventUpdatedAt: expect.any(String), registrationPolicy: "optional" });
    const noFormRevision = (await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/registration-settings`,
    ).then((response) => response.json())) as { eventUpdatedAt: string };

    const removeRequiredTerms = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/terms`,
      {
        method: "PUT",
        body: JSON.stringify({
          expectedUpdatedAt: noFormRevision.eventUpdatedAt,
          configuration: { attendee: [], speaker: [], presentation: [] },
        }),
      },
    );
    expect(removeRequiredTerms.status, await removeRequiredTerms.clone().text()).toBe(422);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM event_terms WHERE event_id = ? AND audience_type = 'attendee' AND active = 1 AND required = 1",
      )
        .bind(created.id)
        .first(),
    ).toEqual({ count: 1 });

    const form = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/forms/event_registration`,
      {
        method: "POST",
        body: JSON.stringify({
          expectedUpdatedAt: noFormRevision.eventUpdatedAt,
          definition: {
            key: `event-attendee-${crypto.randomUUID()}`,
            title: "Workshop attendee questions",
            fields: [{ key: "topic", label: "Topic", fieldType: "text", required: true, sortOrder: 0 }],
          },
        }),
      },
    );
    expect(form.status, await form.clone().text()).toBe(201);
    const formBody = (await form.json()) as {
      form: { form: { id: string }; placement: { id: string; contextType: string; contextRef: string } };
      eventUpdatedAt: string;
    };
    expect(formBody.form.placement).toMatchObject({ contextType: "event", contextRef: created.id });
    expect(
      await env.DB.prepare("SELECT scope_type, scope_ref FROM forms WHERE id = ?").bind(formBody.form.form.id).first(),
    ).toEqual({ scope_type: "community", scope_ref: fixture.ownerGroupId });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM form_placements WHERE form_id = ?")
        .bind(formBody.form.form.id)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await env.DB.prepare("SELECT context_type, context_ref, audience FROM form_placements WHERE form_id = ?")
        .bind(formBody.form.form.id)
        .first(),
    ).toEqual({ context_type: "event", context_ref: created.id, audience: "attendee" });

    const catalog = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/forms/event_registration/available?q=Workshop&limit=1`,
    );
    expect(catalog.status, await catalog.clone().text()).toBe(200);
    expect(await catalog.json()).toMatchObject({ forms: [{ id: formBody.form.form.id }], page: { total: 1 } });

    const remove = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/forms/event_registration`,
      {
        method: "PUT",
        body: JSON.stringify({
          expectedUpdatedAt: formBody.eventUpdatedAt,
          formId: null,
        }),
      },
    );
    expect(remove.status, await remove.clone().text()).toBe(200);
    expect(await remove.json()).toMatchObject({ purpose: "event_registration", form: null });
    expect(
      await env.DB.prepare("SELECT active FROM form_placements WHERE id = ?").bind(formBody.form.placement.id).first(),
    ).toEqual({ active: 0 });
    expect(noFormRevision.eventUpdatedAt).not.toBe(formBody.eventUpdatedAt);
  });

  it("rejects a stale settings read and preserves a repurposed placement", async () => {
    const fixture = await createFixture();
    const created = await createGroupEvent(fixture);
    await env.DB.prepare(
      `INSERT INTO event_terms
         (id, event_id, audience_type, term_key, version, required, active, display_text, created_at)
       VALUES (?, ?, 'attendee', 'terms', '1', 1, 1, 'I agree', datetime('now'))`,
    )
      .bind(crypto.randomUUID(), created.id)
      .run();

    const form = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/forms/event_registration`,
      {
        method: "POST",
        body: JSON.stringify({
          expectedUpdatedAt: created.updatedAt,
          definition: {
            key: `event-attendee-race-${crypto.randomUUID()}`,
            title: "Repurposed attendee form",
            fields: [],
          },
        }),
      },
    );
    expect(form.status, await form.clone().text()).toBe(201);
    const formBody = (await form.json()) as {
      form: { form: { id: string }; placement: { id: string } };
      eventUpdatedAt: string;
    };

    const racingDb = movePlacementAfterRead(env.DB, () =>
      updateGroupFormPlacement(env.DB, fixture.ownerLeader, fixture.ownerGroupId, formBody.form.placement.id, {
        contextType: "group",
        contextRef: fixture.ownerGroupId,
        audience: "group_member",
      }),
    );
    await expect(
      replaceGroupEventForm(
        racingDb,
        fixture.ownerLeader,
        fixture.ownerGroupId,
        created.id,
        "event_registration",
        formBody.eventUpdatedAt,
        null,
      ),
    ).rejects.toMatchObject({ code: "EVENT_FLOW_FORM_CHANGED" });

    expect(
      await env.DB.prepare("SELECT context_type, context_ref, audience, active FROM form_placements WHERE id = ?")
        .bind(formBody.form.placement.id)
        .first(),
    ).toEqual({
      context_type: "group",
      context_ref: fixture.ownerGroupId,
      audience: "group_member",
      active: 1,
    });
  });

  it("rolls back when an inactive replacement placement is repurposed before reactivation", async () => {
    const fixture = await createFixture();
    const created = await createGroupEvent(fixture);
    await env.DB.prepare(
      `INSERT INTO event_terms
         (id, event_id, audience_type, term_key, version, required, active, display_text, created_at)
       VALUES (?, ?, 'attendee', 'terms', '1', 1, 1, 'I agree', datetime('now'))`,
    )
      .bind(crypto.randomUUID(), created.id)
      .run();

    const activeFormResponse = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/forms/event_registration`,
      {
        method: "POST",
        body: JSON.stringify({
          expectedUpdatedAt: created.updatedAt,
          definition: {
            key: `event-attendee-active-${crypto.randomUUID()}`,
            title: "Active attendee form",
            fields: [],
          },
        }),
      },
    );
    expect(activeFormResponse.status, await activeFormResponse.clone().text()).toBe(201);
    const activeFormBody = (await activeFormResponse.json()) as { eventUpdatedAt: string };

    const inactiveFormId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO forms
         (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
       VALUES (?, ?, 'community', ?, 'event_registration', 'active', 'Inactive attendee form', NULL,
               datetime('now'), datetime('now'))`,
    )
      .bind(inactiveFormId, `event-attendee-inactive-${crypto.randomUUID()}`, fixture.ownerGroupId)
      .run();
    const inactivePlacement = await createManagedFormPlacement(env.DB, fixture.ownerLeader.id, inactiveFormId, {
      ownerGroupId: fixture.ownerGroupId,
      contextType: "event",
      contextRef: created.id,
      audience: "attendee",
      active: false,
    });

    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      updateGroupFormPlacement(env.DB, fixture.ownerLeader, fixture.ownerGroupId, inactivePlacement.id, {
        contextType: "group",
        contextRef: fixture.ownerGroupId,
        audience: "group_member",
      }),
    );
    await expect(
      replaceGroupEventForm(
        racingDb,
        fixture.ownerLeader,
        fixture.ownerGroupId,
        created.id,
        "event_registration",
        activeFormBody.eventUpdatedAt,
        inactiveFormId,
      ),
    ).rejects.toMatchObject({ code: "EVENT_FLOW_FORM_CHANGED" });

    expect(
      await env.DB.prepare("SELECT context_type, context_ref, audience, active FROM form_placements WHERE id = ?")
        .bind(inactivePlacement.id)
        .first(),
    ).toEqual({
      context_type: "group",
      context_ref: fixture.ownerGroupId,
      audience: "group_member",
      active: 0,
    });
    expect(await env.DB.prepare("SELECT registration_mode FROM events WHERE id = ?").bind(created.id).first()).toEqual({
      registration_mode: "no_registration",
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'event_registration_settings_updated' AND entity_id = ?",
      )
        .bind(created.id)
        .first(),
    ).toEqual({ count: 0 });
  });

  it("requires exact event management and rolls back stale or revoked registration settings", async () => {
    const fixture = await createFixture();
    const created = await createGroupEvent(fixture);
    await env.DB.prepare(
      `INSERT INTO event_terms
         (id, event_id, audience_type, term_key, version, required, active, display_text, created_at)
       VALUES (?, ?, 'attendee', 'terms', '1', 1, 1, 'I agree', datetime('now'))`,
    )
      .bind(crypto.randomUUID(), created.id)
      .run();

    const denied = await request(
      fixture.granteeLeaderToken,
      `/api/v1/groups/${fixture.granteeGroupId}/events/${created.id}/registration-settings`,
    );
    expect(denied.status).toBe(403);
    await grantResourceToGroup(env.DB, fixture.administrator, fixture.ownerGroupId, "event", created.id, {
      granteeGroupId: fixture.granteeGroupId,
      capability: "view",
    });
    expect(
      (
        await request(
          fixture.granteeLeaderToken,
          `/api/v1/groups/${fixture.granteeGroupId}/events/${created.id}/registration-settings`,
        )
      ).status,
    ).toBe(403);
    await grantResourceToGroup(env.DB, fixture.administrator, fixture.ownerGroupId, "event", created.id, {
      granteeGroupId: fixture.granteeGroupId,
      capability: "register",
    });
    expect(
      (
        await request(
          fixture.granteeLeaderToken,
          `/api/v1/groups/${fixture.granteeGroupId}/events/${created.id}/registration-settings`,
        )
      ).status,
    ).toBe(403);

    const current = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/registration-settings`,
    );
    const currentBody = (await current.json()) as { eventUpdatedAt: string };
    const first = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/registration-settings`,
      {
        method: "PUT",
        body: JSON.stringify({ expectedUpdatedAt: currentBody.eventUpdatedAt, registrationPolicy: "required" }),
      },
    );
    expect(first.status, await first.clone().text()).toBe(200);
    const firstBody = (await first.json()) as { eventUpdatedAt: string };
    const stale = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/registration-settings`,
      {
        method: "PUT",
        body: JSON.stringify({ expectedUpdatedAt: currentBody.eventUpdatedAt, registrationPolicy: "public" }),
      },
    );
    expect(stale.status, await stale.clone().text()).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "EVENT_REGISTRATION_SETTINGS_CHANGED" } });
    expect(await env.DB.prepare("SELECT registration_mode FROM events WHERE id = ?").bind(created.id).first()).toEqual({
      registration_mode: "required",
    });

    await expect(
      replaceGroupEventRegistrationSettings(
        mutateBeforeNextBatch(env.DB, async () => {
          await env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE user_id = ?")
            .bind(fixture.ownerLeader.id)
            .run();
        }),
        fixture.ownerLeader,
        fixture.ownerGroupId,
        created.id,
        firstBody.eventUpdatedAt,
        "optional",
      ),
    ).rejects.toMatchObject({ code: "EVENT_REGISTRATION_SETTINGS_CHANGED" });
    expect(await env.DB.prepare("SELECT registration_mode FROM events WHERE id = ?").bind(created.id).first()).toEqual({
      registration_mode: "required",
    });
  });

  it("manages exact portal event forms through one purpose-parameterized lifecycle", async () => {
    const fixture = await createFixture();
    const created = await createGroupEvent(fixture);
    const base = `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/forms`;

    const attendeeCreate = await request(fixture.ownerLeaderToken, `${base}/event_registration`, {
      method: "POST",
      body: JSON.stringify({
        expectedUpdatedAt: created.updatedAt,
        definition: {
          key: `event-attendee-${crypto.randomUUID()}`,
          title: "Attendee questions",
          fields: [{ key: "topic", label: "Topic", fieldType: "text", required: true, sortOrder: 0 }],
        },
      }),
    });
    expect(attendeeCreate.status, await attendeeCreate.clone().text()).toBe(201);
    const attendee = (await attendeeCreate.json()) as {
      eventUpdatedAt: string;
      purpose: string;
      form: { form: { id: string }; placement: { id: string; ownerGroupId: string; audience: string } };
    };
    expect(attendee).toMatchObject({
      purpose: "event_registration",
      form: { placement: { ownerGroupId: fixture.ownerGroupId, audience: "attendee" } },
    });

    const proposalCreate = await request(fixture.ownerLeaderToken, `${base}/proposal_submission`, {
      method: "POST",
      body: JSON.stringify({
        expectedUpdatedAt: attendee.eventUpdatedAt,
        definition: {
          key: `event-proposal-${crypto.randomUUID()}`,
          title: "Proposal questions",
          fields: [{ key: "audience", label: "Audience", fieldType: "text", required: true, sortOrder: 0 }],
        },
      }),
    });
    expect(proposalCreate.status, await proposalCreate.clone().text()).toBe(201);
    const proposal = (await proposalCreate.json()) as {
      eventUpdatedAt: string;
      form: { form: { id: string }; placement: { ownerGroupId: string; audience: string } };
    };
    expect(proposal.form.placement).toMatchObject({ ownerGroupId: fixture.ownerGroupId, audience: "speaker" });

    const listed = await request(
      fixture.ownerLeaderToken,
      `${base}/event_registration/available?q=attendee&sort=title&limit=1`,
    );
    expect(listed.status, await listed.clone().text()).toBe(200);
    expect(await listed.json()).toMatchObject({ forms: [{ id: attendee.form.form.id }], page: { limit: 1, total: 1 } });

    const read = await request(fixture.ownerLeaderToken, `${base}/event_registration`);
    expect(read.status, await read.clone().text()).toBe(200);
    expect(await read.json()).toMatchObject({ form: { form: { id: attendee.form.form.id } } });

    const clear = await request(fixture.ownerLeaderToken, `${base}/event_registration`, {
      method: "PUT",
      body: JSON.stringify({ expectedUpdatedAt: proposal.eventUpdatedAt, formId: null }),
    });
    expect(clear.status, await clear.clone().text()).toBe(200);
    const cleared = (await clear.json()) as { eventUpdatedAt: string; form: null };
    expect(cleared.form).toBeNull();

    const reactivate = await request(fixture.ownerLeaderToken, `${base}/event_registration`, {
      method: "PUT",
      body: JSON.stringify({ expectedUpdatedAt: cleared.eventUpdatedAt, formId: attendee.form.form.id }),
    });
    expect(reactivate.status, await reactivate.clone().text()).toBe(200);
    const reactivated = (await reactivate.json()) as { eventUpdatedAt: string };
    expect(
      await env.DB.prepare("SELECT active FROM form_placements WHERE id = ?").bind(attendee.form.placement.id).first(),
    ).toEqual({ active: 1 });

    const stale = await request(fixture.ownerLeaderToken, `${base}/event_registration`, {
      method: "PUT",
      body: JSON.stringify({ expectedUpdatedAt: cleared.eventUpdatedAt, formId: null }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "EVENT_FLOW_FORM_CHANGED" } });
    expect(reactivated.eventUpdatedAt).not.toBe(cleared.eventUpdatedAt);

    const invalidPurpose = await request(fixture.ownerLeaderToken, `${base}/survey`);
    expect(invalidPurpose.status).toBe(400);
  });

  it("uses event ownership for delegated form management and fails closed for malformed or stale portal placement state", async () => {
    const fixture = await createFixture();
    const created = await createGroupEvent(fixture);
    const base = `/api/v1/groups/${fixture.ownerGroupId}/events/${created.id}/forms/event_registration`;
    const createdForm = await request(fixture.ownerLeaderToken, base, {
      method: "POST",
      body: JSON.stringify({
        expectedUpdatedAt: created.updatedAt,
        definition: { key: `owned-${crypto.randomUUID()}`, title: "Owner form", fields: [] },
      }),
    });
    const ownerForm = (await createdForm.json()) as {
      eventUpdatedAt: string;
      form: { form: { id: string }; placement: { id: string } };
    };
    await grantResourceToGroup(env.DB, fixture.administrator, fixture.ownerGroupId, "event", created.id, {
      granteeGroupId: fixture.granteeGroupId,
      capability: "manage",
    });
    const delegatedBase = `/api/v1/groups/${fixture.granteeGroupId}/events/${created.id}/forms/event_registration`;
    const delegatedCatalog = await request(fixture.granteeLeaderToken, `${delegatedBase}/available?q=Owner`);
    expect(delegatedCatalog.status, await delegatedCatalog.clone().text()).toBe(200);
    expect(await delegatedCatalog.json()).toMatchObject({ forms: [{ id: ownerForm.form.form.id }] });

    const detached = await request(fixture.granteeLeaderToken, delegatedBase, {
      method: "PUT",
      body: JSON.stringify({ expectedUpdatedAt: ownerForm.eventUpdatedAt, formId: null }),
    });
    expect(detached.status, await detached.clone().text()).toBe(200);
    const detachedBody = (await detached.json()) as { eventUpdatedAt: string };
    const reattached = await request(fixture.granteeLeaderToken, delegatedBase, {
      method: "PUT",
      body: JSON.stringify({ expectedUpdatedAt: detachedBody.eventUpdatedAt, formId: ownerForm.form.form.id }),
    });
    expect(reattached.status, await reattached.clone().text()).toBe(200);
    expect(
      await env.DB.prepare("SELECT owner_group_id FROM form_placements WHERE id = ?")
        .bind(ownerForm.form.placement.id)
        .first(),
    ).toEqual({ owner_group_id: fixture.ownerGroupId });

    await env.DB.prepare("UPDATE form_placements SET opens_at = '2099-01-01T00:00:00.000Z' WHERE id = ?")
      .bind(ownerForm.form.placement.id)
      .run();
    const managementRead = await request(fixture.ownerLeaderToken, base);
    expect(managementRead.status, await managementRead.clone().text()).toBe(200);
    expect(await managementRead.json()).toMatchObject({ form: { form: { id: ownerForm.form.form.id } } });
    expect(
      await getActiveFormForEvent(env.DB, { id: created.id, source_mode: "portal" }, "event_registration"),
    ).toBeNull();

    await env.DB.prepare("UPDATE form_placements SET opens_at = NULL, owner_group_id = NULL WHERE id = ?")
      .bind(ownerForm.form.placement.id)
      .run();
    expect(
      await getActiveFormForEvent(env.DB, { id: created.id, source_mode: "portal" }, "event_registration"),
    ).toBeNull();
    await expect(
      validateCustomAnswersForSubmission(env.DB, {
        event: { id: created.id, source_mode: "portal" },
        purpose: "event_registration",
        customAnswers: { topic: "must not persist" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      replaceGroupEventForm(
        mutateBeforeNextBatch(env.DB, async () => {
          await env.DB.prepare("UPDATE events SET owner_group_id = ? WHERE id = ?")
            .bind(fixture.granteeGroupId, created.id)
            .run();
        }),
        fixture.ownerLeader,
        fixture.ownerGroupId,
        created.id,
        "proposal_submission",
        detachedBody.eventUpdatedAt,
        null,
      ),
    ).rejects.toMatchObject({ code: "EVENT_FLOW_FORM_CHANGED" });
  });

  it("rejects legacy administrator placement creation and retargeting for portal event flows", async () => {
    const fixture = await createFixture();
    const created = await createGroupEvent(fixture);
    const adminToken = await createAdminSession(
      env.DB,
      fixture.administrator.id,
      `legacy-admin-${crypto.randomUUID()}`,
    );
    const formId = crypto.randomUUID();
    const formKey = `legacy-event-flow-${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO forms
         (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
       VALUES (?, ?, 'global', NULL, 'event_registration', 'active', 'Legacy flow form', NULL, datetime('now'), datetime('now'))`,
    )
      .bind(formId, formKey)
      .run();

    const createToPortal = await request(adminToken, `/api/v1/admin/forms/${formKey}/placements`, {
      method: "POST",
      body: JSON.stringify({
        contextType: "event",
        contextRef: created.id,
        audience: "attendee",
        active: true,
      }),
    });
    expect(createToPortal.status, await createToPortal.clone().text()).toBe(403);
    expect(await createToPortal.json()).toMatchObject({ error: { code: "PORTAL_EVENT_FORM_MANAGEMENT_REQUIRED" } });

    const placementId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO form_placements
         (id, form_id, owner_group_id, context_type, context_ref, audience, active, opens_at, closes_at, created_at, updated_at)
       VALUES (?, ?, NULL, 'group', ?, 'group_member', 1, NULL, NULL, datetime('now'), datetime('now'))`,
    )
      .bind(placementId, formId, fixture.ownerGroupId)
      .run();
    const retargetToPortal = await request(adminToken, `/api/v1/admin/forms/${formKey}/placements/${placementId}`, {
      method: "PATCH",
      body: JSON.stringify({ contextType: "event", contextRef: created.id, audience: "attendee" }),
    });
    expect(retargetToPortal.status, await retargetToPortal.clone().text()).toBe(403);
    expect(await retargetToPortal.json()).toMatchObject({ error: { code: "PORTAL_EVENT_FORM_MANAGEMENT_REQUIRED" } });
    expect(
      await env.DB.prepare("SELECT context_type, context_ref FROM form_placements WHERE id = ?")
        .bind(placementId)
        .first(),
    ).toEqual({ context_type: "group", context_ref: fixture.ownerGroupId });
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
