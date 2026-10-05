import { grantAdministrator } from "./helpers/administrator";
import { staffingFixture } from "./helpers/agenda-staffing";
import { roomRecommendations } from "../functions/_lib/services/event-participation/room-recommendations";
import { personalAgenda } from "../functions/_lib/services/event-participation/personal-agenda";
import { publishAgenda } from "../functions/_lib/services/event-agenda/mutations";
import { individualAppearanceFixture, seedApprovedSessionAppearances } from "./helpers/agenda-appearances";
import { operationalPeople } from "../functions/_lib/services/event-agenda/operational-people";
import { physicalOccupiedSql } from "../functions/_lib/services/event-participation/capacity-accounting";
import { processSelectedOutbox } from "../functions/_lib/email/outbox";
import { createTemplateVersion, activateTemplateVersion } from "../functions/_lib/email/templates";
import type { Env } from "../functions/_lib/types";
import { setSessionInvitation, setSessionDelegation } from "../functions/_lib/services/event-participation/invitations";
import { callApi } from "./helpers/app";
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
  it("recommends a larger equipped room without silently moving protected allocations", async () => {
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
    );
    expect(response.status).toBe(200);
    const attendeeToken = await createAdminSession(env.DB, firstUser, crypto.randomUUID());
    const denied = await callApi(
      env,
      `/api/v1/events/calendar-test/agenda/occurrences/${occurrenceId}/room-recommendations`,
      { headers: { authorization: `Bearer ${attendeeToken}` } },
    );
    expect(denied.status).toBe(403);
    const result = await roomRecommendations(env.DB, eventId, "calendar-test", occurrenceId);
    expect(result.demand.physical).toMatchObject({ confirmed: 1, pending: 0, waitlisted: 1, occupied: 1 });
    expect(result.recommendations.find((room) => room.roomId === large)).toMatchObject({
      fit: "review",
      proposedRoomId: large,
      proposedAdditionalRoomIds: [small],
      proposedCapacity: 2,
      newRoomDemand: 1,
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
  it("rejects publication when physical presenters exceed the session pool", async () => {
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
    await expect(publishAgenda(env.DB, eventId, "calendar-test", 1, admin)).rejects.toMatchObject({
      code: "AGENDA_RESERVED_CAPACITY",
    });
    expect(
      await env.DB.prepare("SELECT published_revision FROM event_agenda_state WHERE event_id=?").bind(eventId).first(),
    ).toMatchObject({ published_revision: 0 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_operational_people WHERE event_id=?")
        .bind(eventId)
        .first(),
    ).toMatchObject({ count: 0 });
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
    snapshot.blocks = [
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
        blocks: snapshot.blocks,
        roleMembers: snapshot.roleMembers,
        assignments: [{ blockId: "block", role: "mc", userId: firstUser, pinned: true }],
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
  it("separately enforces physical room pools and preserves a full-room switch", async () => {
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
    await expect(
      setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
        action: "reserve",
        attendanceMode: "physical",
      }),
    ).rejects.toThrow("Choose the physical room");
    expect(
      await setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
        action: "reserve",
        attendanceMode: "physical",
        roomId: firstRoom,
      }),
    ).toMatchObject({ status: "reserved" });
    expect(
      await setSessionParticipation(env.DB, eventId, occurrenceId, secondUser, {
        action: "reserve",
        attendanceMode: "physical",
        roomId: secondRoom,
      }),
    ).toMatchObject({ status: "reserved" });
    await expect(
      setSessionParticipation(env.DB, eventId, occurrenceId, firstUser, {
        action: "reserve",
        attendanceMode: "physical",
        roomId: secondRoom,
      }),
    ).rejects.toThrow("preserved");
    expect(
      await env.DB.prepare("SELECT room_id FROM agenda_session_participations WHERE occurrence_id=? AND user_id=?")
        .bind(occurrenceId, firstUser)
        .first("room_id"),
    ).toBe(firstRoom);
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
    expect((await listSessionHolds(env.DB, eventId, occurrenceId)).items).toHaveLength(1);
    expect(await revokeSessionHold(env.DB, eventId, occurrenceId, hold.id, admin)).toMatchObject({
      revoked: true,
      promoted: 1,
    });
    expect((await listSessionHolds(env.DB, eventId, occurrenceId)).items).toHaveLength(0);
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
    expect(focused.sessions[0]!.availability).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attendanceMode: "physical", state: "full", bookingAction: "reserve", canSave: true }),
        expect.objectContaining({ attendanceMode: "remote", state: "wrong_mode", bookingAction: null }),
      ]),
    );
    await env.DB.prepare("UPDATE event_agenda_occurrences SET booking_closes_at=? WHERE id=?")
      .bind(new Date(Date.now() - 60000).toISOString(), occurrenceId)
      .run();
    await publish();
    expect(
      (await personalAgenda(env.DB, eventId, secondUser, { occurrenceId })).sessions[0]!.availability[0]!.state,
    ).toBe("closed");
    await env.DB.prepare("UPDATE event_agenda_occurrences SET access_policy='invitation' WHERE id=?")
      .bind(occurrenceId)
      .run();
    await publish();
    expect(
      (await personalAgenda(env.DB, eventId, secondUser, { occurrenceId })).sessions[0]!.availability[0]!.state,
    ).toBe("invitation_required");
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
    const original = await rotateAgendaCalendarSubscription(
      env.DB,
      eventId,
      firstUser,
      "https://pkic.org",
      "calendar-test",
      settings,
    );
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
    await rotateAgendaCalendarSubscription(env.DB, eventId, firstUser, "https://pkic.org", "calendar-test", settings);
    await expect(resolveAgendaCalendarSubscription(env.DB, eventId, token)).rejects.toThrow("not found");
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM agenda_calendar_subscriptions WHERE token_hash=?")
        .bind(token)
        .first("count"),
    ).toBe(0);
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
  it("limits ordinary delegated speakers to their assigned session and rechecks revocation", async () => {
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
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const response = await callApi(
      env,
      `/api/v1/events/calendar-test/agenda/${occurrenceId}/participation/${secondUser}`,
      { method: "PUT", headers, body: JSON.stringify({ decision: "approve" }) },
    );
    expect(response.status).toBe(200);
    const foreign = await callApi(env, `/api/v1/events/calendar-test/agenda/${crypto.randomUUID()}/participation`, {
      headers,
    });
    expect(foreign.status).toBe(403);
    await setSessionDelegation(env.DB, eventId, occurrenceId, admin, { userId: firstUser, enabled: false });
    const revoked = await callApi(env, `/api/v1/events/calendar-test/agenda/${occurrenceId}/participation`, {
      headers,
    });
    expect(revoked.status).toBe(403);
  });
});
