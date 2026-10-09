import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { agendaOccurrencePatchSchema, type AgendaAdmissionPolicy } from "../assets/shared/schemas/event-agenda";
import { personalAgendaResponseSchema } from "../assets/shared/schemas/event-personal-agenda";
import { enrolledOfflineEligibilityResponseSchema } from "../assets/shared/schemas/event-offline-eligibility";
import {
  eventScanResponseSchema,
  sessionParticipationRequestSchema,
  sessionParticipationResponseSchema,
} from "../assets/shared/schemas/event-participation-scanning";
import { sessionVirtualRoomResponseSchema } from "../assets/shared/schemas/event-session-virtual-room";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { patchAgendaOccurrence } from "../functions/_lib/services/event-agenda/mutations";
import { setSessionInvitation } from "../functions/_lib/services/event-participation/invitations";
import { createSessionHold } from "../functions/_lib/services/event-participation/holds";
import { recordSessionInvitationRsvp } from "../functions/_lib/services/event-participation/session-rsvp";
import { promoteSessionWaitlist } from "../functions/_lib/services/event-participation/waitlist";
import { physicalOccupiedSql } from "../functions/_lib/services/event-participation/capacity-accounting";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { grantAdministrator } from "./helpers/administrator";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { queryAll } from "./helpers/context";

const f = createEventScannerFixture();
const roomId = crypto.randomUUID();
const joinUrl = "https://meeting.example.test/optional-session";
let start: string;
let end: string;
let revision: number;
let attendeeToken: string;

async function publish(policy: AgendaAdmissionPolicy = "optional_reservation", access = "open", visibility = "public") {
  await env.DB.prepare("UPDATE event_agenda_occurrences SET admission_policy=?,access_policy=?,visibility=? WHERE id=?")
    .bind(policy, access, visibility, f.occurrenceId)
    .run();
  const snapshot = await getAgenda(env.DB, f.eventId, "scan-test");
  revision += 1;
  snapshot.revision = revision;
  snapshot.publishedRevision = revision;
  await env.DB.prepare(
    "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,?,?,?,?)",
  )
    .bind(crypto.randomUUID(), f.eventId, revision, JSON.stringify(snapshot), f.operatorId, new Date().toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_published_occurrences(event_id,revision,occurrence_id,payload_json,room_json) SELECT ?,?,json_extract(occurrence.value,'$.id'),occurrence.value,(SELECT room.value FROM json_each(?,'$.rooms') room WHERE json_extract(room.value,'$.id')=json_extract(occurrence.value,'$.roomId')) FROM json_each(?,'$.occurrences') occurrence",
  )
    .bind(f.eventId, revision, JSON.stringify(snapshot), JSON.stringify(snapshot))
    .run();
  await env.DB.prepare("UPDATE event_agenda_state SET revision=?,published_revision=? WHERE event_id=?")
    .bind(revision, revision, f.eventId)
    .run();
  return snapshot;
}
async function api(path: string, token = attendeeToken, init: RequestInit = {}) {
  return callApi(env, `/api/v1/events/scan-test${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  });
}
async function participate(
  action: "save" | "reserve" | "request" | "cancel",
  token = attendeeToken,
  expectedPublishedRevision = revision,
) {
  return api(`/agenda/${f.occurrenceId}/participation`, token, {
    method: "PUT",
    body: JSON.stringify(
      sessionParticipationRequestSchema.parse({
        action,
        attendanceMode: "physical",
        roomId,
        expectedPublishedRevision,
      }),
    ),
  });
}
async function accepted(action: "save" | "reserve" | "cancel", token = attendeeToken) {
  const response = await participate(action, token);
  expect(response.status, await response.clone().text()).toBe(200);
  return sessionParticipationResponseSchema.parse(await response.json());
}
async function scan(overrides: Record<string, unknown> = {}) {
  const response = await f.scan(
    f.scanBody({ action: "admission", observedAt: start, roomId, capturePublicationRevision: revision, ...overrides }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return eventScanResponseSchema.parse(await response.json());
}
async function manifest() {
  const response = await api(
    `/offline-eligibility?${new URLSearchParams({ occurrenceId: f.occurrenceId, roomId, deviceId: f.deviceId, epochId: f.epochId })}`,
    f.token,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const body = enrolledOfflineEligibilityResponseSchema.parse(await response.json());
  expect(body.session?.admissionPolicy).toBe("optional_reservation");
  return body.entries.find((row) => row.userId === f.userId)!;
}
async function allocations() {
  return {
    participation: await queryAll(
      env.DB,
      "SELECT id,user_id,status,attendance_mode,room_id,allocation_revision FROM agenda_session_participations ORDER BY id",
    ),
    seats: await env.DB.prepare("SELECT COUNT(*) AS total FROM event_session_admissions WHERE event_id=?")
      .bind(f.eventId)
      .first<number>("total"),
    entry: await env.DB.prepare("SELECT COUNT(*) AS total FROM event_entry_admissions WHERE event_id=?")
      .bind(f.eventId)
      .first<number>("total"),
    spends: await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM event_offline_admission_spends spend JOIN event_offline_admission_grants grant_record ON grant_record.id=spend.grant_id WHERE grant_record.event_id=?",
    )
      .bind(f.eventId)
      .first<number>("total"),
    occupied: await env.DB.prepare(`SELECT ${physicalOccupiedSql("?")} AS occupied`)
      .bind(f.occurrenceId, f.occurrenceId, f.occurrenceId)
      .first<number>("occupied"),
  };
}
async function invite(action: "invite" | "revoke" = "invite") {
  await setSessionInvitation(
    env.DB,
    f.eventId,
    f.occurrenceId,
    f.operatorId,
    { action, userId: f.userId, attendanceMode: "physical", roomId, reasonCode: "organizer_invitation" },
    { secret: "optional-session-invitation-test" },
  );
}
beforeEach(async () => {
  await f.setup();
  revision = 0;
  start = new Date(Date.now() - 600000).toISOString();
  end = new Date(Date.now() + 3600000).toISOString();
  await grantAdministrator(env.DB, f.userId);
  attendeeToken = await createAdminSession(env.DB, f.userId, crypto.randomUUID());
  await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,'Selected room',1)")
    .bind(roomId, f.eventId)
    .run();
  await env.DB.prepare("UPDATE event_agenda_occurrences SET start_at=?,end_at=?,room_id=?,remote_capacity=1 WHERE id=?")
    .bind(start, end, roomId, f.occurrenceId)
    .run();
  await env.DB.prepare("UPDATE events SET settings_json=json_set(settings_json,?,?) WHERE id=?")
    .bind(`$.agenda.sessionMedia.${JSON.stringify(f.occurrenceId)}.joinUrl`, joinUrl, f.eventId)
    .run();
  await publish();
});

describe("optional capacity-backed session registration", () => {
  it("keeps interest separate, reserves capacity, waitlists another attendee, and promotes after cancellation", async () => {
    expect(await accepted("save")).toMatchObject({ status: "saved" });
    expect((await allocations()).occupied).toBe(0);
    expect(await accepted("reserve")).toMatchObject({ status: "reserved" });
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(crypto.randomUUID(), f.eventId, f.operatorId, crypto.randomUUID(), now, now)
      .run();
    expect(await accepted("reserve", f.token)).toMatchObject({ status: "waitlisted" });
    expect((await allocations()).occupied).toBe(1);
    expect(await accepted("cancel")).toMatchObject({ status: "canceled" });
    expect(await promoteSessionWaitlist(env.DB, f.eventId)).toMatchObject({ promoted: 1 });
    expect(
      await env.DB.prepare("SELECT status FROM agenda_session_participations WHERE user_id=? AND occurrence_id=?")
        .bind(f.operatorId, f.occurrenceId)
        .first<string>("status"),
    ).toBe("reserved");
    expect((await allocations()).occupied).toBe(1);
  });

  it("allows unreserved actual admission and attendance even at full reservation capacity without allocating seats", async () => {
    await createSessionHold(env.DB, f.eventId, f.occurrenceId, f.operatorId, {
      userId: f.operatorId,
      attendanceMode: "physical",
      roomId,
      expiresAt: end,
      reasonCode: "organizer_invitation",
    });
    const before = await allocations();
    expect((await manifest()).sessionEligible).toBe(true);
    expect(await scan()).toMatchObject({
      outcome: "eligible",
      admissionDecision: "allowed",
      attendanceRecorded: false,
    });
    expect(await scan({ action: "attendance" })).toMatchObject({
      outcome: "eligible",
      attendanceRecorded: true,
      admissionDecision: null,
    });
    expect(await allocations()).toEqual(before);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM event_attendance_observations").first<number>("total"),
    ).toBe(1);
  });

  it("uses the selected event day rather than the event-wide summary and rejects a different physical location", async () => {
    const dayId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event_days(id,event_id,day_date,label,sort_order,created_at,updated_at) VALUES(?,?,?,'Session day',0,?,?)",
    )
      .bind(dayId, f.eventId, start.slice(0, 10), start, start)
      .run();
    await env.DB.prepare(
      "INSERT INTO registration_day_attendance(id,registration_id,event_day_id,attendance_type,created_at,updated_at) SELECT ?,id,?,'in_person',?,? FROM registrations WHERE event_id=? AND user_id=?",
    )
      .bind(crypto.randomUUID(), dayId, start, start, f.eventId, f.userId)
      .run();
    await env.DB.prepare("UPDATE registrations SET attendance_type='virtual' WHERE event_id=? AND user_id=?")
      .bind(f.eventId, f.userId)
      .run();
    expect((await manifest()).sessionEligible).toBe(true);
    expect(await scan()).toMatchObject({ outcome: "eligible", admissionDecision: "allowed" });
    expect(await scan({ roomId: crypto.randomUUID() })).toMatchObject({
      reason: "wrong_location",
      admissionDecision: "refused",
    });
    await env.DB.prepare("UPDATE registration_day_attendance SET attendance_type='virtual' WHERE event_day_id=?")
      .bind(dayId)
      .run();
    expect((await manifest()).sessionEligible).toBe(false);
    expect(await scan()).toMatchObject({ reason: "wrong_attendance_mode", admissionDecision: "refused" });
    await env.DB.prepare("DELETE FROM registration_day_attendance WHERE event_day_id=?").bind(dayId).run();
    expect((await manifest()).physicalDayEligible).toBe(false);
    expect(await scan()).toMatchObject({ reason: "wrong_attendance_mode", admissionDecision: "refused" });
    expect((await allocations()).participation).toEqual([]);
  });

  it("checks the actual reservation room for required entry while optional entry uses a valid selected room without moving the reservation", async () => {
    const otherRoom = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,'Parallel room',1)")
      .bind(otherRoom, f.eventId)
      .run();
    await env.DB.prepare("INSERT INTO event_agenda_occurrence_rooms(occurrence_id,room_id) VALUES(?,?)")
      .bind(f.occurrenceId, otherRoom)
      .run();
    await publish("reservation");
    expect(await accepted("reserve")).toMatchObject({ status: "reserved" });
    expect(await scan({ roomId: otherRoom })).toMatchObject({
      reason: "missing_registration",
      admissionDecision: "refused",
    });
    const before = await allocations();
    await publish();
    expect(await scan({ roomId: otherRoom })).toMatchObject({ outcome: "eligible", admissionDecision: "allowed" });
    expect(await allocations()).toEqual(before);
  });

  it.each(["public", "private"])(
    "does not bypass the independent invitation requirement for an unreserved %s session",
    async (visibility) => {
      await publish("optional_reservation", "invitation", visibility);
      let before = await allocations();
      expect(before).toMatchObject({ seats: 0, entry: 0, spends: 0, occupied: 0 });
      expect((await manifest()).privateAccess).toBe(false);
      expect(await scan()).toMatchObject({ reason: "missing_registration", admissionDecision: "refused" });
      expect(await allocations()).toEqual(before);
      await invite();
      before = await allocations();
      expect(before).toMatchObject({ seats: 0, entry: 0, spends: 0, occupied: 0 });
      expect((await manifest()).sessionEligible).toBe(true);
      expect(await scan()).toMatchObject({ outcome: "eligible", admissionDecision: "allowed" });
      expect(await allocations()).toEqual(before);
      await invite("revoke");
      before = await allocations();
      expect(before).toMatchObject({ seats: 0, entry: 0, spends: 0, occupied: 0 });
      expect((await manifest()).sessionEligible).toBe(false);
      expect(await scan()).toMatchObject({ admissionDecision: "refused" });
      expect(await allocations()).toEqual(before);
    },
  );

  it("retains required reservations, approval, and preference as distinct policies", async () => {
    await publish("preference");
    const preference = await participate("reserve");
    expect(preference.status).toBe(409);
    expect(await preference.json()).toMatchObject({ error: { code: "SESSION_PREFERENCE_ONLY" } });
    await publish("approval");
    const approval = await participate("request");
    expect(approval.status).toBe(200);
    expect(sessionParticipationResponseSchema.parse(await approval.json()).status).toBe("approval_pending");
    expect(await scan()).toMatchObject({ admissionDecision: "refused" });
    await publish("reservation");
    expect(await scan()).toMatchObject({ admissionDecision: "refused" });
    expect(await accepted("reserve")).toMatchObject({ status: "reserved" });
    expect(await scan()).toMatchObject({ admissionDecision: "allowed" });
    await publish();
    expect((await allocations()).occupied).toBe(1);
  });

  it("requires refreshed publication confirmation and protects existing optional reservations from capacity reduction", async () => {
    expect(await accepted("reserve")).toMatchObject({ status: "reserved" });
    const before = await allocations();
    const shownRevision = revision;
    const snapshot = await publish();
    const stale = await participate("reserve", attendeeToken, shownRevision);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "SESSION_PUBLICATION_CHANGED" } });
    expect(await allocations()).toEqual(before);
    await expect(
      patchAgendaOccurrence(
        env.DB,
        f.eventId,
        "scan-test",
        f.occurrenceId,
        agendaOccurrencePatchSchema.parse({ expectedRevision: snapshot.revision, capacity: 0 }),
        f.operatorId,
      ),
    ).rejects.toMatchObject({ status: 409, code: "AGENDA_RESERVED_CAPACITY" });
    expect(await allocations()).toEqual(before);
  });

  it("turns accepted calendar replies into capacity-backed reservations and declines into cancellation", async () => {
    await invite();
    const invitation = await env.DB.prepare(
      "SELECT id,reply_sequence FROM agenda_session_invitations WHERE occurrence_id=? AND user_id=?",
    )
      .bind(f.occurrenceId, f.userId)
      .first<{ id: string; reply_sequence: number }>();
    const input = {
      invitationId: invitation!.id,
      attendeeEmail: `${f.userId}@example.test`,
      responseStatus: "accepted",
      provider: "test-calendar",
      sourceMessageId: crypto.randomUUID(),
      icsUid: `${invitation!.id}@session-rsvp.pkic.org`,
      invitationSequence: invitation!.reply_sequence,
    };
    const result = await recordSessionInvitationRsvp(env.DB, input);
    expect(result).toMatchObject({ disposition: "applied", participationStatus: "reserved" });
    expect(await recordSessionInvitationRsvp(env.DB, input)).toEqual(result);
    expect((await allocations()).occupied).toBe(1);
    expect(
      await recordSessionInvitationRsvp(env.DB, {
        ...input,
        responseStatus: "declined",
        sourceMessageId: crypto.randomUUID(),
      }),
    ).toMatchObject({ disposition: "applied", participationStatus: "canceled" });
    expect((await allocations()).occupied).toBe(0);
  });

  it("permits the approved virtual-room link for an unreserved in-person attendee while preserving invitation access", async () => {
    const path = `/agenda/occurrences/${f.occurrenceId}/virtual-room`;
    let before = await allocations();
    const response = await api(path);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(sessionVirtualRoomResponseSchema.parse(await response.json()).url).toBe(joinUrl);
    expect(await allocations()).toEqual(before);
    await publish("optional_reservation", "invitation");
    before = await allocations();
    expect((await api(path)).status).toBe(403);
    expect(await allocations()).toEqual(before);
    await invite();
    before = await allocations();
    expect(before).toMatchObject({ seats: 0, entry: 0, spends: 0, occupied: 0 });
    expect((await api(path)).status).toBe(200);
    const personal = await api("/agenda/participation?limit=10");
    expect(personal.status).toBe(200);
    const row = personalAgendaResponseSchema
      .parse(await personal.json())
      .sessions.find((session) => session.id === f.occurrenceId);
    expect(row?.admissionPolicy).toBe("optional_reservation");
    expect(row?.availability.find((choice) => choice.attendanceMode === "physical")?.bookingAction).toBe("reserve");
    expect(await allocations()).toEqual(before);
  });
});
