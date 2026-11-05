import { getEventAnalytics } from "../functions/_lib/services/events/analytics";
import {
  prepareAttendanceChangeStatisticsStatements,
  decodeAttendanceChangeStatistics,
} from "../functions/_lib/services/registrations/attendance-statistics";
import { buildEventRegistrationsPageQuery } from "../functions/_lib/services/registrations/event-registrations";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { attendeeCampaignSelection } from "../functions/_lib/services/event-email-campaign/audience";
import { getEventBySlug } from "../functions/_lib/services/events";
import { eventAttendanceRegistrationsListResponseSchema } from "../assets/shared/schemas/event-registrations";
import { eventRegistrationAttendanceDetailResponseSchema } from "../assets/shared/schemas/event-registration-detail";
import {
  attendeeRegistrationParticipationSchema,
  registrationSubmissionResponseSchema,
} from "../assets/shared/schemas/registration";
import { grantAdministrator } from "./helpers/administrator";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createGroup } from "../functions/_lib/services/groups";
import { grantResourceToGroup } from "../functions/_lib/services/resource-grants";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { insertOrganization, insertUser } from "./helpers/membership";
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
  const grants = role === "admin" ? await grantAdministrator(env.DB, id) : [];
  return { identityType: "user", id, email, grants };
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
  const [ownerLeadership, granteeLeadership] = await Promise.all([
    grantGroupLeadershipCapacity(env.DB, ownerGroup.id, ownerLeader.id),
    grantGroupLeadershipCapacity(env.DB, granteeGroup.id, granteeLeader.id),
  ]);
  ownerLeader.memberId = ownerLeadership.memberId;
  granteeLeader.memberId = granteeLeadership.memberId;
  return {
    administrator,
    ownerGroupId: ownerGroup.id,
    granteeGroupId: granteeGroup.id,
    ownerLeader,
    granteeLeader,
    ownerLeaderToken: await createAdminSession(
      env.DB,
      ownerLeader.id,
      `owner-${crypto.randomUUID()}`,
      undefined,
      ownerLeader.memberId,
    ),
    granteeLeaderToken: await createAdminSession(
      env.DB,
      granteeLeader.id,
      `grantee-${crypto.randomUUID()}`,
      undefined,
      granteeLeader.memberId,
    ),
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
             (id, event_id, user_id, status, source_type, manage_link_secret, created_at, updated_at)
           VALUES (?, ?, ?, 'registered', 'direct', ?, datetime('now'), datetime('now'))`,
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

  it("matches mixed-day registrations by each selected type in lists and campaigns", async () => {
    const fixture = await createFixture();
    const event = await createEvent(fixture);
    const { registrationId, holderId } = await seedAttendees(event.id);
    const legacyUserId = await insertUser(env.DB, "legacy-attendee@example.test");
    const legacyRegistrationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO registrations (id, event_id, user_id, status, source_type, manage_link_secret, created_at, updated_at)
        VALUES (?, ?, ?, 'registered', 'direct', ?, datetime('now'), datetime('now'))`).bind(
        legacyRegistrationId,
        event.id,
        legacyUserId,
        crypto.randomUUID(),
      ),
      env.DB.prepare(`INSERT INTO event_days (id, event_id, day_date, label, attendance_options_json, sort_order, created_at, updated_at)
        VALUES ('mixed-day', ?, '2027-04-13', 'Day 2', '[{"value":"moon_physical","label":"Moon venue","accessMode":"physical"},{"value":"moon_base_42","label":"Moon recording","accessMode":"none"}]', 2, datetime('now'), datetime('now'))`).bind(
        event.id,
      ),
      env.DB.prepare(`INSERT INTO registration_day_attendance (id, registration_id, event_day_id, attendance_type, created_at, updated_at)
        VALUES ('mixed-selection', ?, 'mixed-day', 'moon_base_42', datetime('now'), datetime('now'))`).bind(
        registrationId,
      ),
      env.DB.prepare(`INSERT INTO registration_attendance_history (id, registration_id, event_day_id, from_type, to_type, changed_by, changed_at)
        VALUES ('mixed-change', ?, 'mixed-day', 'moon_physical', 'moon_base_42', 'admin:test', datetime('now'))`).bind(
        registrationId,
      ),
    ]);
    const target = await env.DB.prepare("SELECT user_id FROM registrations WHERE id = ?")
      .bind(registrationId)
      .first<{ user_id: string }>();
    await env.DB.prepare(`INSERT INTO event_day_waitlist_entries (id, event_id, event_day_id, registration_id, user_id, priority_lane, status, position, created_at, updated_at)
      SELECT 'mixed-waitlist', ?, id, ?, ?, 'general', 'waiting', 1, datetime('now'), datetime('now') FROM event_days WHERE event_id = ? AND day_date = '2027-04-12'`)
      .bind(event.id, registrationId, target!.user_id, event.id)
      .run();
    const history = decodeAttendanceChangeStatistics(
      await env.DB.batch(prepareAttendanceChangeStatisticsStatements(env.DB, event.id)),
    );
    expect(history).toMatchObject({ leftInPersonAttendees: 1, leftInPersonDayChanges: 1 });
    const filtered = buildOffsetPageSql(
      buildEventRegistrationsPageQuery(event.id, { attendance_change: "left_in_person", limit: 25, offset: 0 }),
    );
    const page = await env.DB.prepare(filtered.pageSql)
      .bind(...filtered.bindings, 25, 0)
      .all<{ id: string }>();
    expect(page.results.map((row) => row.id)).toEqual([registrationId]);
    const analytics = await getEventAnalytics(
      env.DB,
      { id: event.id, slug: "mixed", name: "Mixed attendance" },
      { includeProposalStats: false },
    );
    expect(analytics.registrations.total).toBe(3);
    expect(analytics.registrations.byAttendanceType).toMatchObject({ in_person: 2, moon_base_42: 1 });
    expect(analytics.registrations.byAttendanceType).not.toHaveProperty("virtual");
    expect(analytics.registrations.byStatusAndType).toContainEqual({
      status: "registered",
      attendance_type: "moon_base_42",
      count: 1,
    });
    for (const [type, expectedIds] of [
      ["in_person", [registrationId, holderId]],
      ["moon_base_42", [registrationId]],
      ["virtual", []],
    ] as const) {
      const response = await request(
        fixture.ownerLeaderToken,
        `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations?attendance_type=${type}`,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const body = eventAttendanceRegistrationsListResponseSchema.parse(await response.json());
      expect(body.registrations.map((row) => row.id).sort()).toEqual([...expectedIds].sort());
      expect(body.stats.byAttendanceType).toMatchObject({ in_person: 2, moon_base_42: 1 });
      expect(body.stats.byAttendanceType).not.toHaveProperty("virtual");
      expect(body.stats.byStatus).toMatchObject({ registered: 3 });
      expect(body.stats.attendanceStatusByType).toMatchObject({
        in_person: { accepted: 1, waitlisted: 1 },
        moon_base_42: { accepted: 1, waitlisted: 0 },
      });
      const row = await env.DB.prepare("SELECT slug FROM events WHERE id = ?").bind(event.id).first<{ slug: string }>();
      const campaign = attendeeCampaignSelection(
        await getEventBySlug(env.DB, row!.slug),
        { audience: "attendees", attendanceType: type },
        null,
      );
      const recipients = await env.DB.prepare(campaign.sql)
        .bind(...campaign.bindings)
        .all<{ registration_id: string }>();
      expect(recipients.results.map((item) => item.registration_id).sort()).toEqual([...expectedIds].sort());
    }
  });

  it("admits and requeues the selected configured option without changing it", async () => {
    const fixture = await createFixture();
    const event = await createEvent(fixture);
    const { registrationId } = await seedAttendees(event.id);
    const target = await env.DB.prepare("SELECT user_id FROM registrations WHERE id = ?")
      .bind(registrationId)
      .first<{ user_id: string }>();
    await env.DB.batch([
      env.DB.prepare("UPDATE event_days SET attendance_options_json = ? WHERE event_id = ?").bind(
        JSON.stringify([{ value: "moon_base", label: "Moon base", accessMode: "remote", capacity: 1 }]),
        event.id,
      ),
      env.DB.prepare(
        "UPDATE registration_day_attendance SET attendance_type = 'moon_base' WHERE registration_id = ?",
      ).bind(registrationId),
      env.DB.prepare(`INSERT INTO event_day_waitlist_entries (id,event_id,event_day_id,registration_id,user_id,priority_lane,status,position,created_at,updated_at)
        SELECT ?, ?, id, ?, ?, 'general', 'waiting', 1, datetime('now'), datetime('now') FROM event_days WHERE event_id = ?`).bind(
        crypto.randomUUID(),
        event.id,
        registrationId,
        target!.user_id,
        event.id,
      ),
    ]);
    const base = `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations/${registrationId}`;
    const admit = await request(fixture.ownerLeaderToken, `${base}/admissions`, {
      method: "POST",
      body: JSON.stringify({ mode: "capacity_exempt", reason: "Approved attendance", dayDates: ["2027-04-12"] }),
    });
    expect(admit.status, await admit.clone().text()).toBe(200);
    expect(
      await env.DB.prepare("SELECT attendance_type FROM registration_day_attendance WHERE registration_id = ?")
        .bind(registrationId)
        .first(),
    ).toEqual({ attendance_type: "moon_base" });
    expect(
      await env.DB.prepare("SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?")
        .bind(registrationId)
        .first(),
    ).toEqual({ status: "accepted" });
    const requeue = await request(fixture.ownerLeaderToken, `${base}/day-attendance`, {
      method: "PATCH",
      body: JSON.stringify({ action: "waitlist", dayDates: ["2027-04-12"] }),
    });
    expect(requeue.status, await requeue.clone().text()).toBe(200);
    expect(
      await env.DB.prepare("SELECT attendance_type FROM registration_day_attendance WHERE registration_id = ?")
        .bind(registrationId)
        .first(),
    ).toEqual({ attendance_type: "moon_base" });
    expect(
      await env.DB.prepare("SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?")
        .bind(registrationId)
        .first(),
    ).toEqual({ status: "waiting" });
  });

  it("opens the attendance details of a registration created from an accepted proposal", async () => {
    const fixture = await createFixture();
    const event = await createEvent(fixture);
    const { registrationId } = await seedAttendees(event.id);
    await env.DB.prepare("UPDATE registrations SET source_type = 'proposal' WHERE id = ?").bind(registrationId).run();

    const response = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations/${registrationId}`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const detail = eventRegistrationAttendanceDetailResponseSchema.parse(await response.json());
    expect(detail.registration).toMatchObject({ id: registrationId, source_type: "proposal" });
    expect(detail.dayAttendance).toEqual([expect.objectContaining({ dayDate: "2027-04-12" })]);
  });

  it("shows an explicitly selected individual identity instead of the member's organization identity", async () => {
    const fixture = await createFixture();
    const event = await createEvent(fixture);
    await env.DB.prepare(
      "INSERT INTO event_days(id,event_id,day_date,created_at,updated_at) VALUES(?,?,'2027-04-12',?,?)",
    )
      .bind(crypto.randomUUID(), event.id, new Date().toISOString(), new Date().toISOString())
      .run();
    await env.DB.prepare("UPDATE events SET registration_mode='optional' WHERE id=?").bind(event.id).run();
    await env.DB.prepare(
      "INSERT INTO event_terms(id,event_id,audience_type,term_key,version,required,active,created_at) VALUES(?,?,'attendee','privacy-policy','v1',1,1,?)",
    )
      .bind(crypto.randomUUID(), event.id, new Date().toISOString())
      .run();
    await env.DB.prepare("UPDATE users SET first_name='name@example.test',last_name='Attendee' WHERE id=?")
      .bind(fixture.ownerLeader.id)
      .run();
    const invalidProfile = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations`,
      {
        method: "POST",
        body: JSON.stringify(
          attendeeRegistrationParticipationSchema.parse({
            dayAttendance: [{ dayDate: "2027-04-12", attendanceType: "virtual" }],
            consents: [{ termKey: "privacy-policy", version: "v1" }],
          }),
        ),
      },
    );
    expect(invalidProfile.status, await invalidProfile.clone().text()).toBe(422);
    expect(await invalidProfile.json()).toMatchObject({ error: { code: "REGISTRATION_PROFILE_INCOMPLETE" } });
    await env.DB.prepare("UPDATE users SET first_name='Individual',last_name='Attendee' WHERE id=?")
      .bind(fixture.ownerLeader.id)
      .run();
    // An affiliation with an employer that is not a consortium member: no membership capacity follows.
    const employer = await insertOrganization(env.DB, "Unrelated employer");
    const employerIdentity = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO identities (id, user_id, organization_id, job_title, source, invited_at, started_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'Unrelated role', 'staff', ?4, ?4, ?4, ?4)`,
    )
      .bind(employerIdentity, fixture.ownerLeader.id, employer, new Date().toISOString())
      .run();
    await env.DB.prepare("UPDATE identities SET is_default = 1 WHERE id = ?").bind(employerIdentity).run();
    const identity = await env.DB.prepare(
      "SELECT id FROM identities WHERE user_id=? AND organization_id IS NULL AND started_at IS NOT NULL AND ended_at IS NULL",
    )
      .bind(fixture.ownerLeader.id)
      .first<{ id: string }>();
    expect(identity).not.toBeNull();
    const response = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations`,
      {
        method: "POST",
        body: JSON.stringify(
          attendeeRegistrationParticipationSchema.parse({
            identityId: identity!.id,
            dayAttendance: [{ dayDate: "2027-04-12", attendanceType: "virtual" }],
            consents: [{ termKey: "privacy-policy", version: "v1" }],
          }),
        ),
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const created = registrationSubmissionResponseSchema.parse(await response.json());
    expect(
      await env.DB.prepare("SELECT registration_identity_id FROM registrations WHERE id=?")
        .bind(created.registrationId)
        .first(),
    ).toEqual({ registration_identity_id: identity!.id });
    // Holding two identities, the leader manages the group acting as the individual one.
    const actingToken = await createAdminSession(
      env.DB,
      fixture.ownerLeader.id,
      `owner-individual-${crypto.randomUUID()}`,
      undefined,
      identity!.id,
    );
    const list = await request(actingToken, `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations`);
    expect(list.status, await list.clone().text()).toBe(200);
    expect(eventAttendanceRegistrationsListResponseSchema.parse(await list.json()).registrations).toEqual([
      expect.objectContaining({ organization_name: null, job_title: null }),
    ]);
  });

  it("lets the event manager resend registration email and refuses other groups", async () => {
    const fixture = await createFixture();
    const event = await createEvent(fixture);
    const { registrationId } = await seedAttendees(event.id);
    const endpoint = `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations/${registrationId}/notifications`;
    const init = { method: "POST", body: JSON.stringify({ type: "confirmation" }) };
    expect((await request(fixture.granteeLeaderToken, endpoint, init)).status).toBe(403);
    const allowed = await request(fixture.ownerLeaderToken, endpoint, init);
    expect(allowed.status, await allowed.clone().text()).toBe(200);
    expect(await allowed.json()).toEqual({ success: true, message: "Email queued" });
    const wrongEvent = await createEvent(fixture);
    expect(
      (
        await request(
          fixture.ownerLeaderToken,
          `/api/v1/groups/${fixture.ownerGroupId}/events/${wrongEvent.id}/registrations/${registrationId}/notifications`,
          init,
        )
      ).status,
    ).toBe(404);
    const invalid = await request(fixture.ownerLeaderToken, endpoint, {
      method: "POST",
      body: JSON.stringify({ type: "unknown" }),
    });
    expect(invalid.status).toBe(400);
  });

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
    expect(listedRegistration?.sponsor_consent).toBe(false);
    for (const privateField of [
      "custom_answers_json",
      "referral_code",
      "rsvp_events_json",
      "has_bounced",
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
          { value: "livestream_lounge", label: "Live stream", capacity: null },
        ]),
        event.id,
      )
      .run();
    const customAttendance = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations/${registrationId}/day-attendance`,
      {
        method: "PATCH",
        body: JSON.stringify({ action: "livestream_lounge", dayDates: ["2027-04-12"] }),
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
    ).toEqual({ attendance_type: "livestream_lounge" });
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
    ).toEqual({ attendance_type: "livestream_lounge" });

    for (const body of [
      { mode: "vip", reason: "x", dayDates: ["2027-04-12"] },
      { mode: "capacity_exempt", reason: "Missing selected day" },
    ]) {
      const invalid = await request(
        fixture.ownerLeaderToken,
        `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations/${registrationId}/admissions`,
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
      `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations/${registrationId}/admissions`,
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

    const returnToInPerson = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations/${registrationId}/day-attendance`,
      { method: "PATCH", body: JSON.stringify({ action: "in_person", dayDates: ["2027-04-12"] }) },
    );
    expect(returnToInPerson.status, await returnToInPerson.clone().text()).toBe(200);

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
      `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations/${registrationId}/admissions`,
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

  it("cancels a registration from the record with event manage, once, and tells the attendee", async () => {
    const fixture = await createFixture();
    const event = await createEvent(fixture);
    const { registrationId } = await seedAttendees(event.id);
    const endpoint = `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations/${registrationId}`;

    // Attendance management alone may move days, not end the registration.
    const refused = await request(fixture.granteeLeaderToken, endpoint, {
      method: "PATCH",
      body: JSON.stringify({ action: "cancel" }),
    });
    expect(refused.status).toBe(403);

    const cancelled = await request(fixture.ownerLeaderToken, endpoint, {
      method: "PATCH",
      body: JSON.stringify({ action: "cancel" }),
    });
    expect(cancelled.status, await cancelled.clone().text()).toBe(200);
    const body = (await cancelled.json()) as { registration: { status: string } };
    expect(body.registration.status).toBe("cancelled");
    expect(
      await env.DB.prepare("SELECT status, cancelled_at FROM registrations WHERE id = ?").bind(registrationId).first(),
    ).toMatchObject({ status: "cancelled" });
    // The status is what ends the registration: its day rows stay on record,
    // as they do for a self-service cancellation, so a restore knows the days.
    const notice = await env.DB.prepare(
      "SELECT subject FROM email_outbox WHERE template_key = 'registration_updated' ORDER BY created_at DESC LIMIT 1",
    ).first<{ subject: string }>();
    expect(notice?.subject).toContain("cancelled");

    const again = await request(fixture.ownerLeaderToken, endpoint, {
      method: "PATCH",
      body: JSON.stringify({ action: "cancel" }),
    });
    expect(again.status).toBe(409);
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
    const vipResponse = await request(
      fixture.ownerLeaderToken,
      `/api/v1/groups/${fixture.ownerGroupId}/events/${event.id}/registrations/${registrationId}/admissions`,
      {
        method: "POST",
        body: JSON.stringify({ mode: "vip", reason: "Cancelled attendee exception", dayDates: ["2027-04-12"] }),
      },
    );
    expect(vipResponse.status, await vipResponse.clone().text()).toBe(409);
    expect(await vipResponse.json()).toMatchObject({ error: { code: "REGISTRATION_CANCELLED" } });
    expect(
      await env.DB.prepare(
        `SELECT status, cancellation_reason_code
           FROM registrations WHERE id = ?`,
      )
        .bind(registrationId)
        .first(),
    ).toEqual({ status: "cancelled", cancellation_reason_code: "attendee_cancelled" });
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

  it("requires manage for a reasoned VIP override while preserving narrower waitlist admission", async () => {
    const fixture = await createFixture();
    const event = await createEvent(fixture);
    const { registrationId } = await seedAttendees(event.id);
    await grantResourceToGroup(env.DB, fixture.administrator, fixture.ownerGroupId, "event", event.id, {
      granteeGroupId: fixture.granteeGroupId,
      capability: "manage_attendance",
    });

    const endpoint = `/api/v1/groups/${fixture.granteeGroupId}/events/${event.id}/registrations/${registrationId}/admissions`;
    const retiredVerbPath = await request(fixture.granteeLeaderToken, endpoint.replace(/\/admissions$/, "/admit"), {
      method: "POST",
      body: JSON.stringify({ mode: "vip", reason: "No compatibility alias", dayDates: ["2027-04-12"] }),
    });
    expect(retiredVerbPath.status).toBe(404);

    const vipDenied = await request(fixture.granteeLeaderToken, endpoint, {
      method: "POST",
      body: JSON.stringify({ mode: "vip", reason: "Requires stronger authority", dayDates: ["2027-04-12"] }),
    });
    expect(vipDenied.status, await vipDenied.clone().text()).toBe(403);

    const nonWaitlistedDenied = await request(fixture.granteeLeaderToken, endpoint, {
      method: "POST",
      body: JSON.stringify({
        mode: "capacity_exempt",
        reason: "Attendance authority remains waitlist-bound",
        dayDates: ["2027-04-12"],
      }),
    });
    expect(nonWaitlistedDenied.status, await nonWaitlistedDenied.clone().text()).toBe(409);
    expect(await nonWaitlistedDenied.json()).toMatchObject({
      error: { code: "REGISTRATION_DAY_NOT_WAITLISTED" },
    });

    await grantResourceToGroup(env.DB, fixture.administrator, fixture.ownerGroupId, "event", event.id, {
      granteeGroupId: fixture.granteeGroupId,
      capability: "manage",
    });
    const admitted = await request(fixture.granteeLeaderToken, endpoint, {
      method: "POST",
      body: JSON.stringify({ mode: "vip", reason: "Approved consortium guest", dayDates: ["2027-04-12"] }),
    });
    expect(admitted.status, await admitted.clone().text()).toBe(200);
    expect(await admitted.json()).toMatchObject({
      registration: { id: registrationId, status: "registered" },
      admittedDayDates: ["2027-04-12"],
    });
    expect(
      await env.DB.prepare(
        `SELECT status, reason_code, reason_note
           FROM event_day_waitlist_entries
          WHERE registration_id = ?`,
      )
        .bind(registrationId)
        .first(),
    ).toEqual({
      status: "accepted",
      reason_code: "admin_capacity_exempt",
      reason_note: "vip:Approved consortium guest",
    });
    const audit = await env.DB.prepare(
      "SELECT details_json FROM audit_log WHERE action = 'registration_admitted' AND entity_id = ?",
    )
      .bind(registrationId)
      .first<{ details_json: string }>();
    expect(JSON.parse(audit!.details_json)).toMatchObject({
      mode: { from: null, to: "vip" },
      reason: { from: null, to: "Approved consortium guest" },
      admittedDayDates: { from: null, to: ["2027-04-12"] },
    });
    expect(
      await env.DB.prepare("SELECT template_key FROM email_outbox WHERE event_id = ? AND recipient_email IS NOT NULL")
        .bind(event.id)
        .first(),
    ).toEqual({ template_key: "registration_updated" });
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

  it("rolls back a VIP override when manage authority is revoked before commit", async () => {
    const fixture = await createFixture();
    const event = await createEvent(fixture);
    const { registrationId } = await seedAttendees(event.id);
    await grantResourceToGroup(env.DB, fixture.administrator, fixture.ownerGroupId, "event", event.id, {
      granteeGroupId: fixture.granteeGroupId,
      capability: "manage",
    });

    await expect(
      admitGroupManagedEventRegistration(
        mutateBeforeNextBatch(env.DB, async () => {
          await env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE user_id = ?")
            .bind(fixture.granteeLeader.id)
            .run();
        }),
        fixture.granteeLeader,
        fixture.granteeGroupId,
        event.id,
        registrationId,
        { mode: "vip", reason: "Must observe live manage authority", dayDates: ["2027-04-12"] },
        "https://example.test",
      ),
    ).rejects.toMatchObject({ code: "EVENT_MANAGEMENT_CONTEXT_CHANGED" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_id = ?").bind(registrationId).first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM email_outbox WHERE event_id = ?").bind(event.id).first(),
    ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM event_day_waitlist_entries WHERE registration_id = ?")
        .bind(registrationId)
        .first(),
    ).toEqual({ count: 0 });
  });
});
