import { profileD1Flow } from "./helpers/d1-flow-profile";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { sessionHoldListSchema } from "../assets/shared/schemas/event-session-holds";
import { grantAdministrator } from "./helpers/administrator";
import { staffingFixture } from "./helpers/agenda-staffing";
import { roomRecommendations } from "../functions/_lib/services/event-participation/room-recommendations";
import { personalAgenda, personalAgendaProgram } from "../functions/_lib/services/event-participation/personal-agenda";
import { publishAgenda } from "../functions/_lib/services/event-agenda/mutations";
import { individualAppearanceFixture, seedApprovedSessionAppearances } from "./helpers/agenda-appearances";
import { operationalPeople } from "../functions/_lib/services/event-agenda/operational-people";
import { physicalOccupiedSql } from "../functions/_lib/services/event-participation/capacity-accounting";
import { processSelectedOutbox } from "../functions/_lib/email/outbox";
import { createTemplateVersion, activateTemplateVersion } from "../functions/_lib/email/templates";
import type { Env } from "../functions/_lib/types";
import { setSessionInvitation, setSessionDelegation } from "../functions/_lib/services/event-participation/invitations";
import { callApi } from "./helpers/app";
import {
  agendaCalendarCurrentSubscriptionSchema,
  agendaCalendarSubscriptionSchema,
} from "../assets/shared/schemas/event-agenda-calendar";
import { createAdminSession } from "./helpers/auth";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { setSessionParticipation } from "../functions/_lib/services/event-participation/session-booking";
import {
  createSessionHold,
  listSessionHolds,
  revokeSessionHold,
} from "../functions/_lib/services/event-participation/holds";
import { promoteSessionWaitlist } from "../functions/_lib/services/event-participation/waitlist";
import { reviewSessionParticipation } from "../functions/_lib/services/event-participation/approval";
import {
  currentAgendaCalendarSubscription,
  revokeAgendaCalendarSubscriptions,
  rotateAgendaCalendarSubscription,
  resolveAgendaCalendarSubscription,
  updateAgendaCalendarSettings,
} from "../functions/_lib/services/event-participation/calendar-subscriptions";
import { personalAgendaCalendar } from "../functions/_lib/services/event-participation/calendar-entries";
import { runAgendaSessionReminders } from "../functions/_lib/services/event-participation/reminders";
import { validateEmailDeliveryGuard } from "../functions/_lib/email/delivery-guard";
const eventId = crypto.randomUUID(),
  occurrenceId = crypto.randomUUID(),
  admin = crypto.randomUUID(),
  firstUser = crypto.randomUUID(),
  secondUser = crypto.randomUUID();
const feedOrigin = { baseUrl: "https://pkic.org", eventSlug: "calendar-test", signingSecret: "test-feed-secret" };
let start: string;
async function publish(policy = "reservation") {
  const snapshot = await getAgenda(env.DB, eventId, "calendar-test");
  snapshot.occurrences[0]!.admissionPolicy = policy as "reservation" | "approval";
  await env.DB.prepare(
    "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,0,?,?,?) ON CONFLICT(event_id,revision) DO UPDATE SET snapshot_json=excluded.snapshot_json",
  )
    .bind(crypto.randomUUID(), eventId, JSON.stringify(snapshot), admin, new Date().toISOString())
    .run();
}
afterEach(() => vi.unstubAllGlobals());
describe("Participation capacity and private calendar lifecycle", () => {
  it("retains real cancellation in starred agenda marks without inventing it for stars", async () => {
    await publish();
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, { action: "reserve" });
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, { action: "cancel" });
    expect(
      (await personalAgendaProgram(env.DB, { id: eventId, slug: "calendar-test" }, firstUser)).marks,
    ).toContainEqual({ id: occurrenceId, saved: true, status: "canceled" });
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, { action: "unsave" });
    expect((await personalAgendaProgram(env.DB, { id: eventId, slug: "calendar-test" }, firstUser)).marks).toEqual([]);
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, { action: "save" });
    expect(
      (await personalAgendaProgram(env.DB, { id: eventId, slug: "calendar-test" }, firstUser)).marks,
    ).toContainEqual({ id: occurrenceId, saved: true, status: "canceled" });
    await setSessionParticipation(env.DB, eventId, occurrenceId, secondUser, { action: "save" });
    expect(
      await setSessionParticipation(env.DB, eventId, occurrenceId, secondUser, { action: "unsave" }),
    ).toMatchObject({ status: "saved" });
    await setSessionParticipation(env.DB, eventId, occurrenceId, secondUser, { action: "save" });
    expect(
      (await personalAgendaProgram(env.DB, { id: eventId, slug: "calendar-test" }, secondUser)).marks,
    ).toContainEqual({ id: occurrenceId, saved: true, status: null });
  });

  it("recommends a larger equipped room for the whole pooled demand without moving the session", async () => {
    const small = crypto.randomUUID(),
      large = crypto.randomUUID(),
      missing = crypto.randomUUID();
    for (const [id, name, capacity, equipment] of [
      [small, "Small", 1, ["projector"]],
      [large, "Large", 3, ["projector"]],
      [missing, "No equipment", 10, []],
    ] as const)
      await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity,equipment_json) VALUES(?,?,?,?,?)")
        .bind(id, eventId, name, capacity, JSON.stringify(equipment))
        .run();
    await env.DB.prepare(
      "UPDATE event_agenda_occurrences SET room_id=?,required_equipment_json='[\"projector\"]' WHERE id=?",
    )
      .bind(small, occurrenceId)
      .run();
    await publish();
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      action: "reserve",
      attendanceMode: "physical",
    });
    await setSessionParticipation(env.DB, eventId, occurrenceId, secondUser, {
      action: "reserve",
      attendanceMode: "physical",
    });
    const organizerToken = await createAdminSession(env.DB, admin, crypto.randomUUID());
    const response = await callApi(
      env,
      `/api/v1/events/calendar-test/agenda/occurrences/${occurrenceId}/room-recommendations`,
      { headers: { authorization: `Bearer ${organizerToken}` } },
      { maxRoundTrips: 1 },
    );
    expect(response.status).toBe(200);
    const attendeeToken = await createAdminSession(env.DB, firstUser, crypto.randomUUID());
    const denied = await callApi(
      env,
      `/api/v1/events/calendar-test/agenda/occurrences/${occurrenceId}/room-recommendations`,
      { headers: { authorization: `Bearer ${attendeeToken}` } },
      { maxRoundTrips: 1 },
    );
    expect(denied.status).toBe(403);
    const result = await roomRecommendations(env.DB, eventId, "calendar-test", occurrenceId);
    expect(result.demand.physical).toMatchObject({ confirmed: 1, pending: 0, waitlisted: 1, occupied: 1 });
    expect(result.recommendations.find((room) => room.roomId === large)).toMatchObject({
      fit: "review",
      proposedRoomId: large,
      // Attendees hold seats in the session, not in the small room, so it need not be kept.
      proposedAdditionalRoomIds: [],
      proposedCapacity: 2,
      newRoomDemand: 2,
    });
    expect(result.recommendations.find((room) => room.roomId === missing)).toMatchObject({ fit: "unavailable" });
    expect(
      await env.DB.prepare("SELECT room_id,capacity FROM event_agenda_occurrences WHERE id=?")
        .bind(occurrenceId)
        .first(),
    ).toMatchObject({ room_id: small, capacity: 1 });
  });
  it("keeps scanner observations and unused offline grants out of room demand and protected allocations", async () => {
    const room = crypto.randomUUID(),
      otherRoom = crypto.randomUUID(),
      grant = crypto.randomUUID(),
      now = new Date().toISOString();
    await env.DB.batch(
      [room, otherRoom].map((id) =>
        env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,?,40)").bind(
          id,
          eventId,
          id,
        ),
      ),
    );
    await env.DB.prepare("UPDATE event_agenda_occurrences SET room_id=? WHERE id=?").bind(room, occurrenceId).run();
    await publish();
    await env.DB.prepare(
      "INSERT INTO event_session_admissions(id,event_id,occurrence_id,user_id,operation_id,admitted_at,room_id) VALUES(?,?,?,?,?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, occurrenceId, firstUser, crypto.randomUUID(), now, room)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_offline_admission_grants(id,event_id,occurrence_id,day_date,operator_user_id,device_id,quantity,published_revision,issued_at,expires_at,created_by,room_id) VALUES(?,?,?,?,?,?,100,0,?,?,?,?)",
    )
      .bind(
        grant,
        eventId,
        occurrenceId,
        now.slice(0, 10),
        admin,
        "legacy-scanner-device",
        now,
        new Date(Date.now() + 3600000).toISOString(),
        admin,
        room,
      )
      .run();
    await env.DB.prepare("INSERT INTO event_offline_admission_entitlements(grant_id,user_id) VALUES(?,?)")
      .bind(grant, secondUser)
      .run();
    const result = await roomRecommendations(env.DB, eventId, "calendar-test", occurrenceId);
    expect(result.demand.physical).toEqual({ confirmed: 0, pending: 0, waitlisted: 0, preferences: 0, occupied: 0 });
    expect(result.recommendations.find((candidate) => candidate.roomId === otherRoom)).toMatchObject({
      fit: "fits",
      physicalDemand: 0,
      newRoomDemand: 0,
      proposedAdditionalRoomIds: [],
    });
  });
  it("warns about saved overlaps beyond the page while excluding adjacent and inaccessible private sessions", async () => {
    const end = new Date(Date.now() + 65 * 60000).toISOString();
    const ids = [];
    for (let index = 0; index < 6; index++) {
      const id = crypto.randomUUID();
      ids.push(id);
      await env.DB.prepare(
        "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,admission_policy,capacity) VALUES(?,?,?,?,?,'preference',NULL)",
      )
        .bind(id, eventId, `Parallel ${index}`, start, end)
        .run();
    }
    const adjacent = crypto.randomUUID(),
      hidden = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,admission_policy,capacity) VALUES(?,?,'Adjacent',?,?,'preference',NULL)",
    )
      .bind(adjacent, eventId, end, new Date(Date.now() + 125 * 60000).toISOString())
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,admission_policy,visibility,capacity) VALUES(?,?,'Hidden private title',?,?,'preference','private',NULL)",
    )
      .bind(hidden, eventId, start, end)
      .run();
    await env.DB.prepare("UPDATE event_agenda_state SET revision=1 WHERE event_id=?").bind(eventId).run();
    await publishAgenda(env.DB, eventId, "calendar-test", 1, admin);
    for (const id of [occurrenceId, ...ids, adjacent])
      await setSessionParticipation(env.DB, eventId, id, firstUser, { action: "save", attendanceMode: "physical" });
    await env.DB.prepare(
      "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,saved,created_at,updated_at) VALUES(?,?,?,?,'physical','saved',1,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, hidden, firstUser, start, start)
      .run();
    const result = await personalAgenda(env.DB, eventId, firstUser, { q: "Reserved session", limit: 1 });
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ status: "saved", saved: true, overlapCount: 6 });
    expect(result.sessions[0]!.overlaps).toHaveLength(5);
    expect(result.sessions[0]!.overlaps.every((overlap) => overlap.title.startsWith("Parallel"))).toBe(true);
  });
  it("publishes when physical presenters exceed the session pool", async () => {
    for (const user of [firstUser, secondUser])
      await env.DB.prepare(
        "INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role) VALUES(?,?,'speaker')",
      )
        .bind(occurrenceId, user)
        .run();
    await env.DB.prepare("UPDATE event_agenda_state SET revision=1 WHERE event_id=?").bind(eventId).run();
    await seedApprovedSessionAppearances(env.DB, {
      occurrenceId,
      reviewerId: admin,
      appearances: [
        individualAppearanceFixture({
          userId: firstUser,
          displayName: "First approved presenter",
          approvedAt: "2026-10-04T00:00:00.000Z",
        }),
        individualAppearanceFixture({
          userId: secondUser,
          displayName: "Second approved presenter",
          approvedAt: "2026-10-04T00:00:00.000Z",
        }),
      ],
    });
    await publishAgenda(env.DB, eventId, "calendar-test", 1, admin);
    expect(
      await env.DB.prepare("SELECT published_revision FROM event_agenda_state WHERE event_id=?").bind(eventId).first(),
    ).toMatchObject({ published_revision: 2 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_operational_people WHERE event_id=?")
        .bind(eventId)
        .first(),
    ).toMatchObject({ count: 2 });
  });
  it("publishes private presenter capacity authority and keeps draft mode changes operationally inert", async () => {
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role) VALUES(?,?,'speaker')",
    )
      .bind(occurrenceId, firstUser)
      .run();
    await env.DB.prepare("UPDATE event_agenda_state SET revision=1 WHERE event_id=?").bind(eventId).run();
    await seedApprovedSessionAppearances(env.DB, {
      occurrenceId,
      reviewerId: admin,
      appearances: [
        individualAppearanceFixture({
          userId: firstUser,
          displayName: "Approved individual presenter",
          approvedAt: "2026-10-04T00:00:00.000Z",
        }),
      ],
    });
    await publishAgenda(env.DB, eventId, "calendar-test", 1, admin);
    expect(
      await env.DB.prepare(`SELECT ${physicalOccupiedSql(`'${occurrenceId}'`)} AS occupied`).first(),
    ).toMatchObject({ occupied: 1 });
    expect(
      await setSessionParticipation(env.DB, eventId, occurrenceId, secondUser, {
        action: "reserve",
        attendanceMode: "physical",
      }),
    ).toMatchObject({ status: "waitlisted" });
    await env.DB.prepare(
      "UPDATE event_agenda_occurrence_speakers SET attendance_mode='remote' WHERE occurrence_id=? AND user_id=?",
    )
      .bind(occurrenceId, firstUser)
      .run();
    expect(
      await env.DB.prepare("SELECT attendance_mode FROM event_agenda_operational_people WHERE occurrence_id=?")
        .bind(occurrenceId)
        .first(),
    ).toMatchObject({ attendance_mode: "physical" });
    const publication = await env.DB.prepare(
      "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=? AND revision=2",
    )
      .bind(eventId)
      .first<{ snapshot_json: string }>();
    expect(JSON.parse(publication!.snapshot_json).assignments).toEqual([]);
    expect(JSON.parse(publication!.snapshot_json).roleMembers).toEqual([]);
  });
  it("deduplicates presenter, hold and reservation seats and rejects contradictory modes", async () => {
    await env.DB.prepare(
      "INSERT INTO event_agenda_operational_people(event_id,revision,occurrence_id,user_id,attendance_mode,room_id,sources_json) VALUES(?,0,?,?,'physical',NULL,?)",
    )
      .bind(eventId, occurrenceId, firstUser, JSON.stringify(["credit:speaker", "block:mc"]))
      .run();
    expect(
      await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
        action: "reserve",
        attendanceMode: "physical",
      }),
    ).toMatchObject({ status: "reserved" });
    await createSessionHold(env.DB, eventId, occurrenceId, admin, {
      userId: firstUser,
      attendanceMode: "physical",
      reasonCode: "staff",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    expect(
      await setSessionParticipation(env.DB, eventId, occurrenceId, secondUser, {
        action: "reserve",
        attendanceMode: "physical",
      }),
    ).toMatchObject({ status: "waitlisted" });
    await expect(
      createSessionHold(env.DB, eventId, occurrenceId, admin, {
        userId: firstUser,
        attendanceMode: "remote",
        reasonCode: "staff",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      }),
    ).rejects.toThrow();
  });
  it("diagnoses conflicting staff/presenter modes and requires one multi-room presenter location", async () => {
    const snapshot = await getAgenda(env.DB, eventId, "calendar-test"),
      session = snapshot.occurrences[0]!;
    session.speakers = [{ userId: firstUser, displayName: "Presenter", attendanceMode: "physical" }];
    snapshot.shifts = [
      {
        id: "block",
        name: "MC",
        startAt: session.startAt!,
        endAt: session.endAt!,
        roomId: null,
        roles: ["mc"],
        roleRequirements: [],
      },
    ];
    snapshot.roleMembers = [
      {
        userId: firstUser,
        displayName: "MC",
        roles: ["mc"],
        availableFrom: null,
        availableUntil: null,
        maxMinutes: null,
        seniority: "senior",
        attendanceMode: "remote",
      },
    ];
    Object.assign(
      snapshot,
      staffingFixture({
        expectedRevision: snapshot.revision,
        shifts: snapshot.shifts,
        roleMembers: snapshot.roleMembers,
        assignments: [{ shiftId: "block", role: "mc", userId: firstUser, pinned: true }],
      }),
    );
    expect(() => operationalPeople(snapshot)).toThrow("conflicting attendance modes");
    snapshot.assignments = [];
    session.roomId = "room-one";
    session.additionalRoomIds = ["room-two"];
    expect(() => operationalPeople(snapshot)).toThrow("Choose one physical location");
    session.speakers[0]!.roomId = "room-two";
    expect(operationalPeople(snapshot)).toMatchObject([
      { user_id: firstUser, room_id: "room-two", attendance_mode: "physical" },
    ]);
    session.speakers[0]!.attendanceMode = "remote";
    expect(operationalPeople(snapshot)).toMatchObject([
      { user_id: firstUser, room_id: null, attendance_mode: "remote" },
    ]);
  });

  it("preserves an historical confirmed place when publication introduces approval", async () => {
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      action: "reserve",
      attendanceMode: "physical",
    });
    await publish("approval");
    expect(
      await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
        action: "reserve",
        attendanceMode: "physical",
      }),
    ).toMatchObject({ status: "reserved", attendanceMode: "physical" });
    await expect(
      setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
        action: "request",
        attendanceMode: "remote",
      }),
    ).rejects.toThrow("existing confirmed place has been preserved");
    expect(
      await env.DB.prepare(
        "SELECT status,attendance_mode AS attendanceMode FROM agenda_session_participations WHERE occurrence_id=? AND user_id=?",
      )
        .bind(occurrenceId, firstUser)
        .first(),
    ).toMatchObject({ status: "reserved", attendanceMode: "physical" });
  });
  it("does not let more than one hundred blocked waiters starve a free session pool", async () => {
    const nextId = crypto.randomUUID(),
      now = new Date().toISOString();
    await env.DB.prepare("UPDATE event_agenda_occurrences SET capacity=0 WHERE id=?").bind(occurrenceId).run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,admission_policy,capacity) VALUES(?,?,'Available pool',?,?,'reservation',1)",
    )
      .bind(nextId, eventId, start, new Date(Date.now() + 65 * 60000).toISOString())
      .run();
    await publish();
    const statements = [];
    for (let index = 0; index < 101; index++) {
      const user = crypto.randomUUID();
      statements.push(
        env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)").bind(
          user,
          `${user}@example.test`,
          `${user}@example.test`,
        ),
        env.DB.prepare(
          "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
        ).bind(crypto.randomUUID(), eventId, user, crypto.randomUUID(), now, now),
        env.DB.prepare(
          "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at,waitlisted_at) VALUES(?,?,?,?,'physical','waitlisted',?,?,?)",
        ).bind(crypto.randomUUID(), eventId, occurrenceId, user, now, now, "2000-01-01T00:00:00.000Z"),
      );
    }
    for (let offset = 0; offset < statements.length; offset += 90)
      await env.DB.batch(statements.slice(offset, offset + 90));
    await env.DB.prepare(
      "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at,waitlisted_at) VALUES(?,?,?,?,'physical','waitlisted',?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, nextId, firstUser, now, now, now)
      .run();
    expect(await promoteSessionWaitlist(env.DB, eventId, 100)).toMatchObject({ inspected: 1, promoted: 1 });
    expect(
      await env.DB.prepare("SELECT status FROM agenda_session_participations WHERE occurrence_id=? AND user_id=?")
        .bind(nextId, firstUser)
        .first("status"),
    ).toBe("reserved");
  });
  it("keeps preference sessions first come first served and lets attendees change their preference mode", async () => {
    await publish("preference");
    await expect(
      setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
        action: "reserve",
        attendanceMode: "physical",
      }),
    ).rejects.toThrow("first come");
    expect(
      await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
        action: "save",
        attendanceMode: "physical",
      }),
    ).toMatchObject({ status: "saved", attendanceMode: "physical" });
    expect(
      await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
        action: "save",
        attendanceMode: "remote",
      }),
    ).toMatchObject({ status: "saved", attendanceMode: "remote" });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM agenda_session_participations WHERE occurrence_id=? AND status='reserved'",
      )
        .bind(occurrenceId)
        .first("count"),
    ).toBe(0);
  });
  it("projects the approved public agenda with only the viewer's active marks", async () => {
    await publish("preference");
    const event = { id: eventId, slug: "calendar-test" };
    const empty = await personalAgendaProgram(env.DB, event, firstUser);
    expect(empty.agenda?.occurrences.map((occurrence) => occurrence.id)).toContain(occurrenceId);
    expect(empty.agenda?.shifts).toEqual([]);
    expect(empty.agenda?.roleMembers).toEqual([]);
    expect(empty.marks).toEqual([]);
    // Each scheduled session carries the viewer's own admission, the same the session details read.
    const listed = await personalAgenda(env.DB, eventId, firstUser, { occurrenceId, limit: 1 });
    expect(listed.sessions[0]?.availability).not.toBeNull();
    expect(empty.availability).toEqual([{ id: occurrenceId, availability: listed.sessions[0]!.availability }]);
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      action: "save",
      attendanceMode: "physical",
    });
    expect((await personalAgendaProgram(env.DB, event, firstUser)).marks).toEqual([
      { id: occurrenceId, saved: true, status: null },
    ]);
    expect((await personalAgendaProgram(env.DB, event, secondUser)).marks).toEqual([]);
    // Unstarring an unbooked session clears only interest; it does not invent a canceled booking.
    expect(
      await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
        action: "unsave",
        attendanceMode: "physical",
      }),
    ).toMatchObject({ status: "saved" });
    expect((await personalAgendaProgram(env.DB, event, firstUser)).marks).toEqual([]);
    await env.DB.prepare("DELETE FROM event_agenda_publications WHERE event_id=?").bind(eventId).run();
    expect(await personalAgendaProgram(env.DB, event, firstUser)).toEqual({
      agenda: null,
      marks: [],
      availability: [],
    });
  });
  it("adds to one viewer's program only the private sessions they are invited to or hold a place on", async () => {
    const later = (minutes: number) => new Date(Date.now() + minutes * 60000).toISOString();
    const [invited, booked, hidden] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const [id, title] of [
      [invited, "Invited roundtable"],
      [booked, "Booked briefing"],
      [hidden, "Hidden private title"],
    ] as const)
      await env.DB.prepare(
        "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,admission_policy,visibility,capacity) VALUES(?,?,?,?,?,'reservation','private',5)",
      )
        .bind(id, eventId, title, later(120), later(180))
        .run();
    await publish("preference");
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO agenda_session_invitations(id,event_id,occurrence_id,user_id,invited_by,reason_code,created_at) VALUES(?,?,?,?,?,'organizer_invitation',?)",
    )
      .bind(crypto.randomUUID(), eventId, invited, firstUser, admin, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,saved,created_at,updated_at) VALUES(?,?,?,?,'physical','reserved',0,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, booked, firstUser, now, now)
      .run();
    const event = { id: eventId, slug: "calendar-test" };
    const own = await personalAgendaProgram(env.DB, event, firstUser);
    const ids = own.agenda?.occurrences.map((occurrence) => occurrence.id) ?? [];
    expect(ids).toEqual(expect.arrayContaining([occurrenceId, invited, booked]));
    expect(ids).not.toContain(hidden);
    expect(own.marks).toEqual([{ id: booked, saved: false, status: "reserved" }]);
    // Sanitized like the public projection: no private room link travels with it.
    expect(own.agenda?.occurrences.find((occurrence) => occurrence.id === invited)?.virtualRoomUrl).toBeUndefined();
    const other = await personalAgendaProgram(env.DB, event, secondUser);
    expect(other.agenda?.occurrences.map((occurrence) => occurrence.id)).toEqual([occurrenceId]);
    // The listing applies the same rule: an invitation alone admits a private session.
    const listed = await personalAgenda(env.DB, eventId, firstUser, { limit: 10 });
    expect(listed.sessions.map((session) => session.id).sort()).toEqual([occurrenceId, invited, booked].sort());
  });

  it("bounds the listing to sessions still running or ahead and to the reader's own agenda", async () => {
    const ended = crypto.randomUUID(),
      ahead = crypto.randomUUID();
    const at = (minutes: number) => new Date(Date.now() + minutes * 60000).toISOString();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,admission_policy,capacity) VALUES(?,?,'Ended',?,?,'preference',NULL),(?,?,'Ahead',?,?,'preference',NULL)",
    )
      .bind(ended, eventId, at(-120), at(-60), ahead, eventId, at(90), at(150))
      .run();
    await publish("preference");
    await setSessionParticipation(env.DB, eventId, ended, firstUser, { action: "save", attendanceMode: "physical" });
    await setSessionParticipation(env.DB, eventId, ahead, firstUser, { action: "save", attendanceMode: "physical" });
    const from = new Date().toISOString();
    const upcoming = await personalAgenda(env.DB, eventId, firstUser, { from, sort: "startAt" });
    expect(upcoming.sessions.map((session) => session.id)).toEqual([occurrenceId, ahead]);
    // Service reads only: authentication and event visibility are measured separately by HTTP tests.
    const profile = profileD1Flow(env.DB);
    const mine = await personalAgenda(profile.db, eventId, firstUser, {
      from,
      mine: "true",
      sort: "startAt",
      limit: 1,
    });
    expect(profile.summary().roundTrips).toBe(1);
    expect(mine.sessions.map((session) => session.id)).toEqual([ahead]);
    expect(mine.page).toMatchObject({ total: 1, hasMore: false });
    expect(
      (await personalAgenda(env.DB, eventId, firstUser, { mine: "true", sort: "startAt" })).sessions.map(
        (session) => session.id,
      ),
    ).toEqual([ended, ahead]);
    const empty = profileD1Flow(env.DB);
    expect((await personalAgenda(empty.db, eventId, secondUser, { from, mine: "true" })).sessions).toEqual([]);
    expect(empty.summary().roundTrips).toBe(1);
  });

  it("takes the seat's attendance mode from the person's day and puts a reserved session on their agenda", async () => {
    const saved = (user: string) =>
      env.DB.prepare(
        "SELECT saved,attendance_mode FROM agenda_session_participations WHERE occurrence_id=? AND user_id=?",
      )
        .bind(occurrenceId, user)
        .first<{ saved: number; attendance_mode: string }>();
    // An in-person day gives a physical seat; reserving it also stars the session.
    expect(await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, { action: "reserve" })).toEqual({
      status: "reserved",
      attendanceMode: "physical",
    });
    expect(await saved(firstUser)).toEqual({ saved: 1, attendance_mode: "physical" });
    // A virtual day attends online, so the person never shares the room's seats.
    await env.DB.prepare("UPDATE registrations SET attendance_type='virtual' WHERE event_id=? AND user_id=?")
      .bind(eventId, secondUser)
      .run();
    expect(await setSessionParticipation(env.DB, eventId, occurrenceId, secondUser, { action: "reserve" })).toEqual({
      status: "reserved",
      attendanceMode: "remote",
    });
    // Releasing the seat keeps the star; unstarring takes it off the agenda, and a star puts it back without reserving.
    expect(await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, { action: "cancel" })).toMatchObject(
      {
        status: "canceled",
      },
    );
    expect(await saved(firstUser)).toMatchObject({ saved: 1 });
    expect(await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, { action: "unsave" })).toMatchObject(
      { status: "canceled" },
    );
    expect(await saved(firstUser)).toMatchObject({ saved: 0 });
    expect(await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, { action: "save" })).toMatchObject({
      status: "canceled",
    });
    expect(await saved(firstUser)).toEqual({ saved: 1, attendance_mode: "physical" });
    // An on-demand registration attends neither way, so there is no seat to take.
    await env.DB.prepare("UPDATE registrations SET attendance_type='on_demand' WHERE event_id=? AND user_id=?")
      .bind(eventId, firstUser)
      .run();
    await expect(
      setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, { action: "reserve" }),
    ).rejects.toMatchObject({ code: "SESSION_ATTENDANCE_DAY_REQUIRED" });
  });
  it("adds combined rooms into one seat pool and never takes a room from the attendee", async () => {
    const firstRoom = crypto.randomUUID(),
      secondRoom = crypto.randomUUID();
    for (const [id, name] of [
      [firstRoom, "Main"],
      [secondRoom, "Overflow"],
    ])
      await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,?,1)")
        .bind(id, eventId, name)
        .run();
    await env.DB.prepare("UPDATE event_agenda_occurrences SET room_id=?,capacity=2 WHERE id=?")
      .bind(firstRoom, occurrenceId)
      .run();
    await env.DB.prepare("INSERT INTO event_agenda_occurrence_rooms(occurrence_id,room_id) VALUES(?,?)")
      .bind(occurrenceId, secondRoom)
      .run();
    await publish();
    // Each room seats one; together they seat both attendees.
    for (const user of [firstUser, secondUser])
      expect(await setSessionParticipation(env.DB, eventId, occurrenceId, user, { action: "reserve" })).toMatchObject({
        status: "reserved",
        attendanceMode: "physical",
      });
    await expect(
      setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, { action: "reserve", roomId: secondRoom }),
    ).rejects.toThrow("roomId");
    const focused = await personalAgenda(env.DB, eventId, firstUser, { occurrenceId, limit: 1 });
    expect(focused.sessions[0]!.availability).toMatchObject({ attendanceMode: "physical", bookingAction: "reserve" });
  });
  it("audits hold release and immediately promotes the first eligible waiter", async () => {
    const hold = await createSessionHold(env.DB, eventId, occurrenceId, admin, {
      userId: secondUser,
      attendanceMode: "physical",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      reasonCode: "staff",
    });
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      action: "reserve",
      attendanceMode: "physical",
    });
    const token = await createAdminSession(env.DB, admin, crypto.randomUUID());
    const readHolds = async () => {
      const response = await callApi(
        env,
        `/api/v1/events/calendar-test/agenda/occurrences/${occurrenceId}/holds`,
        { headers: { authorization: `Bearer ${token}` } },
        { maxRoundTrips: 1 },
      );
      expect(response.status).toBe(200);
      return sessionHoldListSchema.parse(await response.json());
    };
    expect((await readHolds()).items.map((item) => item.id)).toEqual([hold.id]);
    expect((await listSessionHolds(env.DB, eventId, occurrenceId)).items).toHaveLength(1);
    expect(await revokeSessionHold(env.DB, eventId, occurrenceId, hold.id, admin)).toMatchObject({
      revoked: true,
      promoted: 1,
    });
    expect((await listSessionHolds(env.DB, eventId, occurrenceId)).items).toHaveLength(0);
    expect((await readHolds()).items).toEqual([]);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM agenda_session_invitation_audit WHERE occurrence_id=? AND action IN ('create_hold','revoke_hold')",
      )
        .bind(occurrenceId)
        .first("count"),
    ).toBe(2);
  });
  it("sends a new invitation after revocation while retries remain idempotent", async () => {
    const body = {
      userId: firstUser,
      attendanceMode: "physical",
      action: "invite",
      reasonCode: "organizer_invitation",
    };
    await setSessionInvitation(env.DB, eventId, occurrenceId, admin, body);
    const original = await env.DB.prepare(
      "SELECT id,reply_sequence FROM agenda_session_invitations WHERE occurrence_id=? AND user_id=?",
    )
      .bind(occurrenceId, firstUser)
      .first();
    const audits = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action='session_invitation_issued'",
    ).first("count");
    await setSessionInvitation(env.DB, eventId, occurrenceId, admin, body);
    expect(
      await env.DB.prepare(
        "SELECT id,reply_sequence FROM agenda_session_invitations WHERE occurrence_id=? AND user_id=?",
      )
        .bind(occurrenceId, firstUser)
        .first(),
    ).toEqual(original);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action='session_invitation_issued'").first(
        "count",
      ),
    ).toBe(audits);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM email_outbox WHERE template_key='agenda_session_invitation'",
      ).first("count"),
    ).toBe(1);
    await setSessionInvitation(env.DB, eventId, occurrenceId, admin, { ...body, action: "revoke" });
    await setSessionInvitation(env.DB, eventId, occurrenceId, admin, body);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM email_outbox WHERE template_key='agenda_session_invitation'",
      ).first("count"),
    ).toBe(2);
  });
  it("deduplicates allocation notices while preference changes preserve the reservation", async () => {
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      action: "reserve",
      attendanceMode: "physical",
    });
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      action: "reserve",
      attendanceMode: "physical",
    });
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      action: "save",
      attendanceMode: "remote",
    });
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      action: "unsave",
      attendanceMode: "remote",
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM email_outbox WHERE template_key='agenda_session_booking' AND recipient_user_id=?",
      )
        .bind(firstUser)
        .first("count"),
    ).toBe(1);
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      action: "cancel",
      attendanceMode: "physical",
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM email_outbox WHERE template_key='agenda_session_booking' AND recipient_user_id=?",
      )
        .bind(firstUser)
        .first("count"),
    ).toBe(2);
  });
  beforeEach(async () => {
    await resetDb();
    const now = new Date().toISOString();
    start = new Date(Date.now() + 5 * 60000).toISOString();
    for (const id of [admin, firstUser, secondUser])
      await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
        .bind(id, `${id}@example.test`, `${id}@example.test`)
        .run();
    await grantAdministrator(env.DB, admin);
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,'calendar-test','Calendar test','UTC','invite_or_open','{}',?,?)",
    )
      .bind(eventId, now, now)
      .run();
    for (const id of [firstUser, secondUser])
      await env.DB.prepare(
        "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
      )
        .bind(crypto.randomUUID(), eventId, id, crypto.randomUUID(), now, now)
        .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,admission_policy,capacity) VALUES(?,?,'Reserved session',?,?,'reservation',1)",
    )
      .bind(occurrenceId, eventId, start, new Date(Date.now() + 65 * 60000).toISOString())
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,0,?)",
    )
      .bind(eventId, now)
      .run();
    await publish();
  });
  it("projects focused live full, closed and invitation-required actions without changing allocations", async () => {
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      action: "reserve",
      attendanceMode: "physical",
    });
    const focused = await personalAgenda(env.DB, eventId, secondUser, { occurrenceId, limit: 1 });
    expect(focused.sessions).toHaveLength(1);
    // Only the attendance mode of the person's day is offered; they never choose another.
    expect(focused.sessions[0]!.availability).toEqual({
      attendanceMode: "physical",
      state: "full",
      bookingAction: "reserve",
      message: expect.any(String),
    });
    await env.DB.prepare("UPDATE event_agenda_occurrences SET booking_closes_at=? WHERE id=?")
      .bind(new Date(Date.now() - 60000).toISOString(), occurrenceId)
      .run();
    await publish();
    expect((await personalAgenda(env.DB, eventId, secondUser, { occurrenceId })).sessions[0]!.availability!.state).toBe(
      "closed",
    );
    await env.DB.prepare("UPDATE event_agenda_occurrences SET access_policy='invitation' WHERE id=?")
      .bind(occurrenceId)
      .run();
    await publish();
    expect((await personalAgenda(env.DB, eventId, secondUser, { occurrenceId })).sessions[0]!.availability!.state).toBe(
      "invitation_required",
    );
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM agenda_session_participations WHERE user_id=?")
        .bind(secondUser)
        .first(),
    ).toMatchObject({ count: 0 });
  });
  it("counts organizer holds, preserves waitlist ordering, and promotes after expiry", async () => {
    const hold = await createSessionHold(env.DB, eventId, occurrenceId, admin, {
      userId: firstUser,
      attendanceMode: "physical",
      reasonCode: "staff",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    expect(
      await setSessionParticipation(env.DB, eventId, occurrenceId, secondUser, {
        attendanceMode: "physical",
        action: "reserve",
      }),
    ).toMatchObject({ status: "waitlisted" });
    expect((await promoteSessionWaitlist(env.DB, eventId)).promoted).toBe(0);
    await env.DB.prepare("UPDATE agenda_session_holds SET expires_at=? WHERE id=?")
      .bind(new Date(Date.now() - 1).toISOString(), hold.id)
      .run();
    expect((await promoteSessionWaitlist(env.DB, eventId)).promoted).toBe(1);
  });
  it("keeps approval independent of a full physical pool", async () => {
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      attendanceMode: "physical",
      action: "reserve",
    });
    await publish("approval");
    expect(
      await setSessionParticipation(env.DB, eventId, occurrenceId, secondUser, {
        attendanceMode: "physical",
        action: "request",
      }),
    ).toMatchObject({ status: "approval_pending" });
    expect(await reviewSessionParticipation(env.DB, eventId, occurrenceId, secondUser, "approve", admin)).toMatchObject(
      {
        status: "waitlisted",
      },
    );
    expect(
      await env.DB.prepare("SELECT approval_state FROM agenda_session_participations WHERE user_id=?")
        .bind(secondUser)
        .first("approval_state"),
    ).toBe("approved");
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      attendanceMode: "physical",
      action: "cancel",
    });
    expect((await promoteSessionWaitlist(env.DB, eventId)).promoted).toBe(1);
  });
  it("rotates hash-only feeds and preserves UID with increased cancellation sequence", async () => {
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      attendanceMode: "physical",
      action: "reserve",
    });
    const settings = { includeTentative: false, reminderEnabled: false, reminderMinutes: 10 };
    const original = await rotateAgendaCalendarSubscription(env.DB, eventId, firstUser, feedOrigin, settings);
    const token = new URL(original.url).pathname.split("/").at(-2)!;
    expect((await resolveAgendaCalendarSubscription(env.DB, eventId, token)).user_id).toBe(firstUser);
    const active = await personalAgendaCalendar(env.DB, eventId, firstUser, false);
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      attendanceMode: "physical",
      action: "cancel",
    });
    const canceled = await personalAgendaCalendar(env.DB, eventId, firstUser, false);
    expect(active).toContain(`UID:agenda-${occurrenceId}@ics.pkic.org`);
    expect(canceled).toContain(`UID:agenda-${occurrenceId}@ics.pkic.org`);
    expect(canceled).toContain("STATUS:CANCELLED");
    expect(canceled).toContain("SEQUENCE:1");
    const replacement = await rotateAgendaCalendarSubscription(env.DB, eventId, firstUser, feedOrigin, settings);
    await expect(resolveAgendaCalendarSubscription(env.DB, eventId, token)).rejects.toThrow("not found");
    expect(replacement.url).not.toBe(original.url);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM agenda_calendar_subscriptions WHERE token_hash=?")
        .bind(token)
        .first("count"),
    ).toBe(0);
  });
  it("cancels a released seat in calendars while the session stays starred", async () => {
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      attendanceMode: "physical",
      action: "reserve",
    });
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, { action: "cancel" });
    expect(
      await env.DB.prepare("SELECT status,saved FROM agenda_session_participations WHERE occurrence_id=? AND user_id=?")
        .bind(occurrenceId, firstUser)
        .first(),
    ).toEqual({ status: "canceled", saved: 1 });
    const uid = `UID:agenda-${occurrenceId}@ics.pkic.org`;
    const confirmedOnly = await personalAgendaCalendar(env.DB, eventId, firstUser, false);
    expect(confirmedOnly).toContain(uid);
    expect(confirmedOnly).toContain("STATUS:CANCELLED");
    expect(confirmedOnly).toContain("SEQUENCE:1");
    // A feed that carries starred sessions keeps it, no longer confirmed.
    const withStarred = await personalAgendaCalendar(env.DB, eventId, firstUser, true);
    expect(withStarred).toContain(uid);
    expect(withStarred).toContain("STATUS:TENTATIVE");
    expect(withStarred).toContain("SEQUENCE:1");
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, { action: "unsave" });
    const unstarred = await personalAgendaCalendar(env.DB, eventId, firstUser, true);
    expect(unstarred).toContain("STATUS:CANCELLED");
    expect(unstarred).toContain("SEQUENCE:2");
  });
  it("shows the owner's active link again from its hash without storing the token", async () => {
    const settings = { includeTentative: false, reminderEnabled: false, reminderMinutes: 10 };
    expect(await currentAgendaCalendarSubscription(env.DB, eventId, firstUser, feedOrigin)).toEqual({
      active: false,
      subscription: null,
    });
    const created = await rotateAgendaCalendarSubscription(env.DB, eventId, firstUser, feedOrigin, settings);
    const current = await currentAgendaCalendarSubscription(env.DB, eventId, firstUser, feedOrigin);
    expect(current).toEqual({ active: true, subscription: created });
    const token = new URL(created.url).pathname.split("/").at(-2)!;
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM agenda_calendar_subscriptions WHERE token_hash=?")
        .bind(token)
        .first("count"),
    ).toBe(0);
    expect(await currentAgendaCalendarSubscription(env.DB, eventId, secondUser, feedOrigin)).toMatchObject({
      active: false,
    });
    // A different secret cannot reproduce the link, so the active link is reported but never guessed.
    expect(
      await currentAgendaCalendarSubscription(env.DB, eventId, firstUser, { ...feedOrigin, signingSecret: "other" }),
    ).toEqual({ active: true, subscription: null });
    await revokeAgendaCalendarSubscriptions(env.DB, eventId, firstUser);
    expect(await currentAgendaCalendarSubscription(env.DB, eventId, firstUser, feedOrigin)).toEqual({
      active: false,
      subscription: null,
    });
  });
  it("serves the active link to its owner through the mounted router", async () => {
    const endpoint = "/api/v1/events/calendar-test/calendar/subscriptions";
    expect((await callApi(env, `${endpoint}/current`)).status).toBe(401);
    const token = await createAdminSession(env.DB, firstUser, crypto.randomUUID());
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const created = await callApi(env, endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ includeTentative: true, reminderEnabled: false, reminderMinutes: 10 }),
    });
    expect(created.status).toBe(200);
    const link = agendaCalendarSubscriptionSchema.parse(await created.json());
    const current = await callApi(env, `${endpoint}/current`, { headers });
    expect(current.status).toBe(200);
    expect(current.headers.get("cache-control")).toContain("no-store");
    expect(agendaCalendarCurrentSubscriptionSchema.parse(await current.json())).toEqual({
      active: true,
      subscription: link,
    });
    const feed = await callApi(env, new URL(link.url).pathname);
    expect(feed.status).toBe(200);
  });
  it("delivers an eligible reminder through the real outbox provider path", async () => {
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      action: "reserve",
      attendanceMode: "physical",
    });
    await updateAgendaCalendarSettings(env.DB, eventId, firstUser, {
      includeTentative: false,
      reminderEnabled: true,
      reminderMinutes: 10,
    });
    await runAgendaSessionReminders(env.DB);
    for (const key of [
      "agenda_session_reminder",
      "email_layout",
      "partial_reg_details",
      "partial_sponsors_block",
      "partial_about_pkic",
      "partial_donation_request",
    ]) {
      const template = await createTemplateVersion(env.DB, {
        templateKey: key,
        content:
          key === "email_layout"
            ? "{{{body_html}}}"
            : key === "agenda_session_reminder"
              ? "Your session {{sessionTitle}} starts at {{sessionStart}}."
              : "Details",
        createdByUserId: admin,
        subjectTemplate: "Details",
      });
      await activateTemplateVersion(env.DB, { templateKey: key, version: template.version });
    }
    const row = await env.DB.prepare("SELECT id FROM email_outbox WHERE template_key='agenda_session_reminder'").first<{
      id: string;
    }>();
    const provider = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", provider);
    await processSelectedOutbox(env.DB, env as unknown as Env, [row!.id]);
    const delivery = await env.DB.prepare("SELECT status,last_error FROM email_outbox WHERE id=?")
      .bind(row!.id)
      .first();
    expect(delivery, JSON.stringify(delivery)).toMatchObject({ status: "sent" });
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("suppresses queued reminders after a live registration cancellation", async () => {
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      attendanceMode: "physical",
      action: "reserve",
    });
    await updateAgendaCalendarSettings(env.DB, eventId, firstUser, {
      includeTentative: false,
      reminderEnabled: true,
      reminderMinutes: 10,
    });
    expect((await runAgendaSessionReminders(env.DB)).queued).toBe(1);
    const row = await env.DB.prepare(
      "SELECT id,payload_json FROM email_outbox WHERE template_key='agenda_session_reminder'",
    ).first<{ id: string; payload_json: string }>();
    const payload = JSON.parse(row!.payload_json) as Record<string, unknown>;
    await expect(validateEmailDeliveryGuard(env.DB, payload)).resolves.toBeUndefined();
    await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE event_id=? AND user_id=?")
      .bind(eventId, firstUser)
      .run();
    await expect(validateEmailDeliveryGuard(env.DB, payload)).rejects.toThrow("no longer deliverable");
    for (const key of [
      "agenda_session_reminder",
      "email_layout",
      "partial_reg_details",
      "partial_sponsors_block",
      "partial_about_pkic",
      "partial_donation_request",
    ]) {
      const template = await createTemplateVersion(env.DB, {
        templateKey: key,
        content:
          key === "email_layout"
            ? "{{{body_html}}}"
            : key === "agenda_session_reminder"
              ? "Your session {{sessionTitle}} starts at {{sessionStart}}."
              : "Details",
        createdByUserId: admin,
        subjectTemplate: "Details",
      });
      await activateTemplateVersion(env.DB, { templateKey: key, version: template.version });
    }
    const provider = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", provider);
    await processSelectedOutbox(env.DB, env as unknown as Env, [row!.id]);
    expect(provider).not.toHaveBeenCalled();
    const delivery = await env.DB.prepare("SELECT status,last_error FROM email_outbox WHERE id=?")
      .bind(row!.id)
      .first();
    expect(delivery, JSON.stringify(delivery)).toMatchObject({ status: "cancelled" });
  });
  it("invites without allocating a seat and blocks uninvited reservations", async () => {
    const snapshot = await getAgenda(env.DB, eventId, "calendar-test");
    snapshot.occurrences[0]!.accessPolicy = "invitation";
    await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE event_id=?")
      .bind(JSON.stringify(snapshot), eventId)
      .run();
    await expect(
      setSessionParticipation(env.DB, eventId, occurrenceId, secondUser, {
        action: "reserve",
        attendanceMode: "physical",
      }),
    ).rejects.toThrow("invitation");
    await setSessionInvitation(env.DB, eventId, occurrenceId, admin, {
      userId: secondUser,
      action: "invite",
      attendanceMode: "physical",
      reasonCode: "organizer_invitation",
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) FROM agenda_session_participations WHERE status='reserved'").first(
        "COUNT(*)",
      ),
    ).toBe(0);
    expect(
      await setSessionParticipation(env.DB, eventId, occurrenceId, secondUser, {
        action: "reserve",
        attendanceMode: "physical",
      }),
    ).toMatchObject({ status: "reserved" });
    await setSessionInvitation(env.DB, eventId, occurrenceId, admin, {
      userId: secondUser,
      action: "revoke",
      attendanceMode: "physical",
      reasonCode: "organizer_invitation",
    });
    expect(
      await env.DB.prepare("SELECT status FROM agenda_session_participations WHERE user_id=?")
        .bind(secondUser)
        .first("status"),
    ).toBe("canceled");
  });
  it("refuses a closed booking window without losing an existing physical reservation", async () => {
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      action: "reserve",
      attendanceMode: "physical",
    });
    const snapshot = await getAgenda(env.DB, eventId, "calendar-test");
    snapshot.occurrences[0]!.bookingClosesAt = new Date(Date.now() - 1000).toISOString();
    await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE event_id=?")
      .bind(JSON.stringify(snapshot), eventId)
      .run();
    await expect(
      setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
        action: "reserve",
        attendanceMode: "remote",
      }),
    ).rejects.toThrow("booking window");
    expect(
      await env.DB.prepare("SELECT attendance_mode FROM agenda_session_participations WHERE user_id=?")
        .bind(firstUser)
        .first("attendance_mode"),
    ).toBe("physical");
  });
  it("never turns saving or removing a preference into a seat cancellation", async () => {
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      action: "reserve",
      attendanceMode: "physical",
    });
    expect(
      await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
        action: "save",
        attendanceMode: "remote",
      }),
    ).toMatchObject({ status: "reserved", attendanceMode: "physical" });
    expect(
      await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
        action: "unsave",
        attendanceMode: "remote",
      }),
    ).toMatchObject({ status: "reserved", attendanceMode: "physical" });
  });
  it("switches overlapping confirmed sessions atomically and preserves the old place when full", async () => {
    const nextId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,admission_policy,capacity) VALUES(?,?,'Replacement',?,?,'reservation',0)",
    )
      .bind(nextId, eventId, start, new Date(Date.now() + 65 * 60000).toISOString())
      .run();
    await publish();
    await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
      action: "reserve",
      attendanceMode: "physical",
    });
    await expect(
      setSessionParticipation(env.DB, eventId, nextId, firstUser, {
        action: "reserve",
        attendanceMode: "physical",
        replaceOccurrenceId: occurrenceId,
      }),
    ).rejects.toThrow("preserved");
    expect(
      await env.DB.prepare("SELECT status FROM agenda_session_participations WHERE occurrence_id=? AND user_id=?")
        .bind(occurrenceId, firstUser)
        .first("status"),
    ).toBe("reserved");
    await env.DB.prepare("UPDATE event_agenda_occurrences SET capacity=1 WHERE id=?").bind(nextId).run();
    await publish();
    expect(
      await setSessionParticipation(env.DB, eventId, nextId, firstUser, {
        action: "reserve",
        attendanceMode: "physical",
        replaceOccurrenceId: occurrenceId,
      }),
    ).toMatchObject({ status: "reserved" });
    expect(
      await env.DB.prepare("SELECT status FROM agenda_session_participations WHERE occurrence_id=? AND user_id=?")
        .bind(occurrenceId, firstUser)
        .first("status"),
    ).toBe("canceled");
  });
  async function delegatedApproval() {
    await publish("approval");
    await env.DB.prepare("INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id) VALUES(?,?)")
      .bind(occurrenceId, firstUser)
      .run();
    await setSessionDelegation(env.DB, eventId, occurrenceId, admin, { userId: firstUser, enabled: true });
    await setSessionParticipation(env.DB, eventId, occurrenceId, secondUser, {
      action: "request",
      attendanceMode: "physical",
    });
    const token = await createAdminSession(env.DB, firstUser, crypto.randomUUID());
    return { authorization: `Bearer ${token}`, "content-type": "application/json" };
  }
  it("limits ordinary delegated speakers to their assigned session and rechecks revocation", async () => {
    const headers = await delegatedApproval();
    const list = (id = occurrenceId) =>
      callApi(
        env,
        `/api/v1/events/calendar-test/agenda/occurrences/${id}/participation?limit=1&sort=-createdAt`,
        { headers },
        { maxRoundTrips: 1 },
      );
    const assigned = await list();
    expect(assigned.status).toBe(200);
    expect(await assigned.json()).toMatchObject({
      participants: [{ userId: secondUser, status: "approval_pending" }],
      page: { total: 1 },
    });
    const location = await callApi(
      env,
      `/api/v1/events/calendar-test/agenda/occurrences/${occurrenceId}/room-recommendations`,
      { headers },
      { maxRoundTrips: 1 },
    );
    expect(location.status).toBe(403);
    const management = await callApi(
      env,
      `/api/v1/events/calendar-test/agenda/occurrences/${occurrenceId}/management`,
      { headers },
      { maxRoundTrips: 1 },
    );
    expect(management.status).toBe(200);
    expect(await management.json()).toMatchObject({ canDelegate: false, speakers: [{ userId: firstUser }] });
    const holds = await callApi(
      env,
      `/api/v1/events/calendar-test/agenda/occurrences/${occurrenceId}/holds`,
      { headers },
      { maxRoundTrips: 1 },
    );
    expect(holds.status).toBe(403);
    const response = await callApi(
      env,
      `/api/v1/events/calendar-test/agenda/occurrences/${occurrenceId}/participation/${secondUser}`,
      { method: "PUT", headers, body: JSON.stringify({ decision: "approve" }) },
    );
    expect(response.status).toBe(200);
    const foreign = await list(crypto.randomUUID());
    expect(foreign.status).toBe(403);
    await setSessionDelegation(env.DB, eventId, occurrenceId, admin, { userId: firstUser, enabled: false });
    const revoked = await list();
    expect(revoked.status).toBe(403);
    await setSessionDelegation(env.DB, eventId, occurrenceId, admin, { userId: firstUser, enabled: true });
    await env.DB.prepare("DELETE FROM event_agenda_occurrence_speakers WHERE occurrence_id=? AND user_id=?")
      .bind(occurrenceId, firstUser)
      .run();
    expect((await list()).status).toBe(403);
    await env.DB.prepare("INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id) VALUES(?,?)")
      .bind(occurrenceId, firstUser)
      .run();
    await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), firstUser)
      .run();
    expect((await list()).status).toBe(401);
  });
  it.each(["delegation", "speaker", "session"] as const)(
    "rolls back a managed approval when %s changes before its command",
    async (change) => {
      const headers = await delegatedApproval();
      const effects = () =>
        Promise.all(
          [
            "SELECT * FROM agenda_session_participations ORDER BY id",
            "SELECT * FROM audit_log ORDER BY id",
            "SELECT * FROM email_outbox ORDER BY id",
            "SELECT * FROM agenda_calendar_entries ORDER BY occurrence_id,user_id",
          ].map(async (sql) => (await env.DB.prepare(sql).all()).results),
        );
      const before = await effects();
      let raced = false;
      const db = mutateBeforeMatchingQuery(
        env.DB,
        (sql) => sql.includes("UPDATE agenda_session_participations AS pending"),
        async () => {
          raced = true;
          if (change === "delegation")
            await env.DB.prepare(
              "UPDATE agenda_session_delegations SET revoked_at=? WHERE occurrence_id=? AND user_id=?",
            )
              .bind(new Date().toISOString(), occurrenceId, firstUser)
              .run();
          else if (change === "speaker")
            await env.DB.prepare("DELETE FROM event_agenda_occurrence_speakers WHERE occurrence_id=? AND user_id=?")
              .bind(occurrenceId, firstUser)
              .run();
          else
            await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?")
              .bind(new Date().toISOString(), firstUser)
              .run();
        },
      );
      const response = await callApi(
        { ...env, DB: db },
        `/api/v1/events/calendar-test/agenda/occurrences/${occurrenceId}/participation/${secondUser}`,
        { method: "PUT", headers, body: JSON.stringify({ decision: "approve" }) },
      );
      expect(raced).toBe(true);
      expect(response.ok).toBe(false);
      expect(await effects()).toEqual(before);
    },
  );
});
