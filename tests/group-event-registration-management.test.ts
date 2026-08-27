import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createGroup } from "../functions/_lib/services/groups";
import { grantResourceToGroup } from "../functions/_lib/services/resource-grants";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import {
  admitGroupManagedEventRegistration,
  updateGroupManagedEventRegistrationDayAttendance,
} from "../functions/_lib/services/registrations/group-attendee-management";

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
  const administrator = await userActor("attendee-management-administrator", "admin");
  const [ownerGroup, granteeGroup] = await Promise.all(
    ["owner", "grantee"].map((suffix) =>
      createGroup(env.DB, administrator, {
        typeKey: "working_group",
        name: `Attendee ${suffix} ${crypto.randomUUID()}`,
        visibility: "authenticated",
        eligibilityMode: "open",
      }),
    ),
  );
  const ownerLeader = await userActor("attendee-management-owner");
  const granteeLeader = await userActor("attendee-management-grantee");
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
    ownerLeaderToken: await createAdminSession(env.DB, ownerLeader.id, `owner-${crypto.randomUUID()}`),
    granteeLeaderToken: await createAdminSession(env.DB, granteeLeader.id, `grantee-${crypto.randomUUID()}`),
  };
}

function request(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return callApi(env, path, { ...init, headers });
}

async function createEvent(fixture: Fixture): Promise<{ id: string }> {
  const response = await request(fixture.ownerLeaderToken, `/api/v1/groups/${fixture.ownerGroupId}/events`, {
    method: "POST",
    body: JSON.stringify({
      slug: `attendee-management-${crypto.randomUUID()}`,
      name: "Attendee management event",
      timezone: "Europe/Amsterdam",
      startsAt: "2027-04-12T08:00:00.000Z",
      endsAt: "2027-04-12T17:00:00.000Z",
      profileKey: "workshop",
      registrationPolicy: "no_registration",
      location: "Online",
    }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const body = (await response.json()) as { event: { id: string } };
  return body.event;
}

async function seedAttendees(eventId: string): Promise<{ registrationId: string; holderId: string }> {
  await env.DB.prepare(
    `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
     VALUES (?, ?, '2027-04-12', 'Day 1', 1, 1, datetime('now'), datetime('now'))`,
  )
    .bind(crypto.randomUUID(), eventId)
    .run();
  const holderUserId = await insertUser(env.DB, `holder-${crypto.randomUUID()}@example.test`);
  const targetUserId = await insertUser(env.DB, `target-${crypto.randomUUID()}@example.test`);
  const holderId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();
  const dayRows = [
    [holderId, holderUserId],
    [registrationId, targetUserId],
  ];
  await env.DB.batch(
    dayRows.flatMap(([id, userId]) => [
      env.DB.prepare(
        `INSERT INTO registrations
             (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
           VALUES (?, ?, ?, 'registered', 'in_person', 'direct', ?, datetime('now'), datetime('now'))`,
      ).bind(id, eventId, userId, `manage-${crypto.randomUUID()}`),
      env.DB.prepare(
        `INSERT INTO registration_day_attendance
             (id, registration_id, event_day_id, attendance_type, created_at, updated_at)
           SELECT ?, ?, id, 'in_person', datetime('now'), datetime('now')
           FROM event_days WHERE event_id = ? AND day_date = '2027-04-12'`,
      ).bind(crypto.randomUUID(), id, eventId),
    ]),
  );
  return { registrationId, holderId };
}

describe("group event attendee management", () => {
  beforeEach(resetDb);

  it("allows owner managers to inspect, waitlist, and admit selected days", async () => {
    const fixture = await createFixture();
    const event = await createEvent(fixture);
    const { registrationId } = await seedAttendees(event.id);

    await env.DB.prepare("UPDATE registrations SET custom_answers_json = ? WHERE id = ?")
      .bind(JSON.stringify({ privateAnswer: "must not leave the administrator boundary" }), registrationId)
      .run();
    const list = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations`,
    );
    expect(list.status, await list.clone().text()).toBe(200);
    const listBody = (await list.json()) as {
      registrations: Array<Record<string, unknown>>;
      stats: Record<string, unknown>;
    };
    const listedRegistration = listBody.registrations.find((registration) => registration.id === registrationId);
    expect(listedRegistration).toBeDefined();
    for (const privateField of [
      "custom_answers_json",
      "referral_code",
      "rsvp_events_json",
      "has_bounced",
      "sponsor_consent",
      "attendanceChangeHistory",
      "lastAttendanceChange",
    ]) {
      expect(listedRegistration).not.toHaveProperty(privateField);
    }
    expect(listBody.stats).not.toHaveProperty("bouncedCount");
    expect(listBody.stats).not.toHaveProperty("consentCount");

    const detail = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations/${registrationId}`,
    );
    expect(detail.status, await detail.clone().text()).toBe(200);
    const detailBody = (await detail.json()) as Record<string, unknown>;
    expect(detailBody).not.toHaveProperty("form");
    expect(detailBody.registration).not.toHaveProperty("customAnswers");
    expect(detailBody.registration).not.toHaveProperty("referral_code");
    const eventDays = detailBody.eventDays as Array<Record<string, unknown>>;
    expect(eventDays).toHaveLength(1);
    expect(eventDays[0]).toMatchObject({ date: "2027-04-12", label: "Day 1" });

    await env.DB.prepare(
      `UPDATE event_days
       SET attendance_options_json = ?
       WHERE event_id = ? AND day_date = '2027-04-12'`,
    )
      .bind(
        JSON.stringify([
          { value: "in_person", label: "In-person", capacity: 1 },
          { value: "livestream", label: "Live stream", capacity: null },
        ]),
        event.id,
      )
      .run();
    const customAttendance = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations/${registrationId}/day-attendance`,
      {
        method: "PATCH",
        body: JSON.stringify({ action: "livestream", dayDates: ["2027-04-12"] }),
      },
    );
    expect(customAttendance.status, await customAttendance.clone().text()).toBe(200);
    expect(
      await env.DB.prepare(
        `SELECT attendance_type FROM registration_day_attendance
         WHERE registration_id = ?`,
      )
        .bind(registrationId)
        .first(),
    ).toEqual({ attendance_type: "livestream" });
    const unsupportedAttendance = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations/${registrationId}/day-attendance`,
      {
        method: "PATCH",
        body: JSON.stringify({ action: "unconfigured", dayDates: ["2027-04-12"] }),
      },
    );
    expect(unsupportedAttendance.status, await unsupportedAttendance.clone().text()).toBe(400);
    expect(
      await env.DB.prepare(
        `SELECT attendance_type FROM registration_day_attendance
         WHERE registration_id = ?`,
      )
        .bind(registrationId)
        .first(),
    ).toEqual({ attendance_type: "livestream" });

    for (const body of [
      { mode: "vip", reason: "Legacy broad admission", dayDates: ["2027-04-12"] },
      { mode: "capacity_exempt", reason: "Missing selected day" },
    ]) {
      const invalid = await request(
        fixture.ownerLeaderToken,
        `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations/${registrationId}/admit`,
        { method: "POST", body: JSON.stringify(body) },
      );
      expect(invalid.status, await invalid.clone().text()).toBe(400);
    }

    const auditBeforeUnwaitlistedAdmit = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE entity_id = ?",
    )
      .bind(registrationId)
      .first<{ count: number }>();
    const outboxBeforeUnwaitlistedAdmit = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM email_outbox WHERE event_id = ?",
    )
      .bind(event.id)
      .first<{ count: number }>();
    const unwaitlistedAdmit = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations/${registrationId}/admit`,
      {
        method: "POST",
        body: JSON.stringify({ mode: "capacity_exempt", reason: "Must not bypass waitlist", dayDates: ["2027-04-12"] }),
      },
    );
    expect(unwaitlistedAdmit.status, await unwaitlistedAdmit.clone().text()).toBe(409);
    expect(await unwaitlistedAdmit.json()).toMatchObject({ error: { code: "REGISTRATION_DAY_NOT_WAITLISTED" } });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_id = ?")
        .bind(registrationId)
        .first<{ count: number }>(),
    ).toEqual(auditBeforeUnwaitlistedAdmit);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM email_outbox WHERE event_id = ?")
        .bind(event.id)
        .first<{ count: number }>(),
    ).toEqual(outboxBeforeUnwaitlistedAdmit);

    const waitlist = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations/${registrationId}/day-attendance`,
      {
        method: "PATCH",
        body: JSON.stringify({ action: "waitlist", dayDates: ["2027-04-12"] }),
      },
    );
    expect(waitlist.status, await waitlist.clone().text()).toBe(200);
    const waiting = await env.DB.prepare(
      `SELECT status FROM event_day_waitlist_entries
       WHERE registration_id = ? AND status = 'waiting'`,
    )
      .bind(registrationId)
      .all<{ status: string }>();
    expect(waiting.results).toEqual([{ status: "waiting" }]);

    const admitted = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations/${registrationId}/admit`,
      {
        method: "POST",
        body: JSON.stringify({ mode: "capacity_exempt", reason: "Approved exception", dayDates: ["2027-04-12"] }),
      },
    );
    expect(admitted.status, await admitted.clone().text()).toBe(200);
    expect(await admitted.json()).toMatchObject({
      registration: { id: registrationId, status: "registered" },
      admittedDayDates: ["2027-04-12"],
    });
    const accepted = await env.DB.prepare(
      `SELECT status FROM event_day_waitlist_entries
       WHERE registration_id = ? AND event_day_id = (SELECT id FROM event_days WHERE event_id = ?)`,
    )
      .bind(registrationId, event.id)
      .first<{ status: string }>();
    expect(accepted).toEqual({ status: "accepted" });
  });

  it("does not let attendance management restore a cancelled registration", async () => {
    const fixture = await createFixture();
    const event = await createEvent(fixture);
    const { registrationId } = await seedAttendees(event.id);
    await env.DB.prepare(
      `UPDATE registrations
          SET status = 'cancelled', cancellation_reason_code = 'attendee_cancelled'
        WHERE id = ?`,
    )
      .bind(registrationId)
      .run();
    const response = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations/${registrationId}/day-attendance`,
      {
        method: "PATCH",
        body: JSON.stringify({ action: "virtual", dayDates: ["2027-04-12"] }),
      },
    );
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "REGISTRATION_CANCELLED" } });
    expect(
      await env.DB.prepare(
        `SELECT status, cancellation_reason_code, attendance_type
           FROM registrations WHERE id = ?`,
      )
        .bind(registrationId)
        .first(),
    ).toEqual({ status: "cancelled", cancellation_reason_code: "attendee_cancelled", attendance_type: "in_person" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_id = ?")
        .bind(registrationId)
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM email_outbox WHERE event_id = ?")
        .bind(event.id)
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });
  });

  it("requires manage_attendance for detail and mutations, including delegated groups", async () => {
    const fixture = await createFixture();
    const event = await createEvent(fixture);
    const { registrationId } = await seedAttendees(event.id);
    for (const capability of ["view", "register"] as const) {
      await grantResourceToGroup(env.DB, fixture.administrator, fixture.ownerGroupId, "event", event.id, {
        granteeGroupId: fixture.granteeGroupId,
        capability,
      });
    }
    const viewDenied = await request(
      fixture.granteeLeaderToken,
      `/api/v1/groups/${fixture.granteeGroupId}/events/${event.id}/registrations/${registrationId}`,
    );
    expect(viewDenied.status).toBe(403);

    await grantResourceToGroup(env.DB, fixture.administrator, fixture.ownerGroupId, "event", event.id, {
      granteeGroupId: fixture.granteeGroupId,
      capability: "manage_attendance",
    });
    const delegated = await request(
      fixture.granteeLeaderToken,
      `/api/v1/groups/${fixture.granteeGroupId}/events/${event.id}/registrations/${registrationId}`,
    );
    expect(delegated.status, await delegated.clone().text()).toBe(200);

    const missingRegistration = await request(
      fixture.granteeLeaderToken,
      `/api/v1/groups/${fixture.granteeGroupId}/events/${event.id}/registrations/${crypto.randomUUID()}`,
    );
    expect(missingRegistration.status).toBe(404);

    const wrongEvent = await createEvent(fixture);
    const wrongGroup = await request(
      fixture.granteeLeaderToken,
      `/api/v1/groups/${fixture.granteeGroupId}/events/${wrongEvent.id}/registrations/${registrationId}`,
    );
    expect(wrongGroup.status).toBe(403);
  });

  it("rolls back an attendee mutation when delegated authority is revoked before commit", async () => {
    const fixture = await createFixture();
    const event = await createEvent(fixture);
    const { registrationId } = await seedAttendees(event.id);
    await grantResourceToGroup(env.DB, fixture.administrator, fixture.ownerGroupId, "event", event.id, {
      granteeGroupId: fixture.granteeGroupId,
      capability: "manage_attendance",
    });
    const auditBefore = await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_id = ?")
      .bind(registrationId)
      .first<{ count: number }>();
    await expect(
      updateGroupManagedEventRegistrationDayAttendance(
        mutateBeforeNextBatch(env.DB, async () => {
          await env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE user_id = ?")
            .bind(fixture.granteeLeader.id)
            .run();
        }),
        fixture.granteeLeader,
        fixture.granteeGroupId,
        event.id,
        registrationId,
        { action: "waitlist", dayDates: ["2027-04-12"] },
        "https://example.test",
      ),
    ).rejects.toMatchObject({ code: "EVENT_ATTENDANCE_MANAGEMENT_CONTEXT_CHANGED" });
    expect(
      await env.DB.prepare("SELECT status FROM registrations WHERE id = ?").bind(registrationId).first(),
    ).toMatchObject({ status: "registered" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_id = ?")
        .bind(registrationId)
        .first<{ count: number }>(),
    ).toEqual(auditBefore);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM email_outbox WHERE event_id = (SELECT event_id FROM registrations WHERE id = ?)",
      )
        .bind(registrationId)
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });
  });

  it("rolls back admission when a selected waitlist row changes before commit", async () => {
    const fixture = await createFixture();
    const event = await createEvent(fixture);
    const { registrationId } = await seedAttendees(event.id);
    await updateGroupManagedEventRegistrationDayAttendance(
      env.DB,
      fixture.ownerLeader,
      fixture.ownerGroupId,
      event.id,
      registrationId,
      { action: "waitlist", dayDates: ["2027-04-12"] },
      "https://example.test",
    );
    const auditBefore = await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_id = ?")
      .bind(registrationId)
      .first<{ count: number }>();
    await expect(
      admitGroupManagedEventRegistration(
        mutateBeforeNextBatch(env.DB, async () => {
          await env.DB.prepare(
            `UPDATE event_day_waitlist_entries
                SET status = 'removed', updated_at = datetime('now')
              WHERE registration_id = ?`,
          )
            .bind(registrationId)
            .run();
        }),
        fixture.ownerLeader,
        fixture.ownerGroupId,
        event.id,
        registrationId,
        { mode: "capacity_exempt", reason: "Must observe live waitlist", dayDates: ["2027-04-12"] },
        "https://example.test",
      ),
    ).rejects.toMatchObject({ code: "REGISTRATION_DAY_WAITLIST_CHANGED" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_id = ?")
        .bind(registrationId)
        .first<{ count: number }>(),
    ).toEqual(auditBefore);
    expect(
      await env.DB.prepare("SELECT attendance_type FROM registration_day_attendance WHERE registration_id = ?")
        .bind(registrationId)
        .first(),
    ).toEqual({ attendance_type: "in_person" });
  });
});
