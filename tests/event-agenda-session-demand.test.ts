import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  agendaOccurrenceListItemSchema,
  agendaOccurrenceListSchema,
  agendaSnapshotSchema,
  agendaStaffingSchema,
} from "../assets/shared/schemas/event-agenda";
import { sessionDemandSchema, emptySessionDemandCounts } from "../assets/shared/schemas/event-session-demand";
import { roomRecommendationsResponseSchema } from "../assets/shared/schemas/event-room-recommendations";
import { personalAgendaResponseSchema } from "../assets/shared/schemas/event-personal-agenda";
import { sessionParticipationRequestSchema } from "../assets/shared/schemas/event-participation-scanning";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import { nowIso } from "../functions/_lib/utils/time";
import type { Env } from "../functions/_lib/types";

let eventId: string, adminId: string, token: string, alpha: string, beta: string;
let revision: number;
const zero = () => ({ physical: emptySessionDemandCounts(), remote: emptySessionDemandCounts() });
async function request(path: string, method = "GET", body?: unknown, authorization = token, environment: Env = env) {
  return callApi(environment, `/api/v1/events/pqc-2026${path}`, {
    method,
    headers: {
      ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function listing(query = "") {
  const response = await request(`/agenda/occurrences${query}`);
  expect(response.status, await response.clone().text()).toBe(200);
  return agendaOccurrenceListSchema.parse(await response.json());
}
async function states() {
  return Promise.all(
    [
      "SELECT * FROM agenda_session_participations ORDER BY id",
      "SELECT * FROM agenda_session_holds ORDER BY id",
      "SELECT * FROM event_agenda_state ORDER BY event_id",
      "SELECT * FROM audit_log ORDER BY id",
      "SELECT * FROM email_outbox ORDER BY id",
    ].map((sql) => queryAll(env.DB, sql)),
  );
}
async function participation(
  occurrenceId: string,
  status: string,
  attendanceMode = "physical",
  saved = false,
  approvalState = "none",
  targetEventId = eventId,
) {
  const userId = await insertUser(env.DB);
  await env.DB.prepare(
    "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,saved,approval_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      targetEventId,
      occurrenceId,
      userId,
      attendanceMode,
      status,
      Number(saved),
      approvalState,
      nowIso(),
      nowIso(),
    )
    .run();
  return userId;
}

describe("Live organizer session demand projection", () => {
  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(env.DB));
    adminId = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'"))[0].id;
    token = await createAdminSession(env.DB, adminId, crypto.randomUUID());
    revision = 0;
    for (const [title, startAt, endAt] of [
      ["Alpha session", "2026-12-01T09:00:00.000Z", "2026-12-01T10:00:00.000Z"],
      ["Beta session", "2026-12-02T09:00:00.000Z", "2026-12-02T10:00:00.000Z"],
    ]) {
      const response = await request("/agenda/occurrences", "POST", {
        expectedRevision: revision,
        title,
        description: "A substantive session abstract on interoperable certificate operations and lifecycle management.",
        startAt,
        endAt,
        roomId: null,
        capacity: 1,
        remoteCapacity: 1,
        admissionPolicy: "reservation",
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const snapshot = agendaSnapshotSchema.parse(await response.json());
      revision = snapshot.revision;
      const id = snapshot.occurrences.find((item) => item.title === title)!.id;
      if (title.startsWith("Alpha")) alpha = id;
      else beta = id;
    }
  });

  it("requires canonical nonnegative integer demand on list rows while draft snapshots have no live demand", async () => {
    expect(
      sessionDemandSchema.safeParse({ ...zero(), physical: { ...emptySessionDemandCounts(), pending: -1 } }).success,
    ).toBe(false);
    expect(
      sessionDemandSchema.safeParse({ ...zero(), remote: { ...emptySessionDemandCounts(), confirmed: 0.5 } }).success,
    ).toBe(false);
    const page = await listing();
    expect(page.occurrences.every((item) => JSON.stringify(item.demand) === JSON.stringify(zero()))).toBe(true);
    const { demand: _demand, ...withoutDemand } = page.occurrences[0];
    expect(agendaOccurrenceListItemSchema.safeParse(withoutDemand).success).toBe(false);
    const draft = agendaSnapshotSchema.parse(await (await request("/agenda")).json());
    expect(draft.occurrences[0]).not.toHaveProperty("demand");
  });

  it("separates reserved, approval pending, approved waitlist and saved preference by mode", async () => {
    await participation(alpha, "reserved", "physical", true);
    await participation(alpha, "approval_pending", "physical", false, "pending");
    await participation(alpha, "waitlisted", "physical", false, "approved");
    await participation(alpha, "saved", "physical");
    await participation(alpha, "canceled", "physical", true);
    await participation(alpha, "reserved", "remote");
    await participation(alpha, "approval_pending", "remote", false, "pending");
    await participation(alpha, "waitlisted", "remote", true, "approved");
    const heldUser = await insertUser(env.DB);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO agenda_session_holds(id,event_id,occurrence_id,user_id,attendance_mode,expires_at,created_by,reason_code,created_at) VALUES(?,?,?,?,'physical','2099-01-01T00:00:00.000Z',?,'organizer_invitation',?)",
      ).bind(crypto.randomUUID(), eventId, alpha, heldUser, adminId, nowIso()),
      env.DB.prepare(
        "INSERT INTO agenda_session_invitations(id,event_id,occurrence_id,user_id,created_at,invited_by,reason_code) VALUES(?,?,?,?,?,?,'organizer_invitation')",
      ).bind(crypto.randomUUID(), eventId, alpha, heldUser, nowIso(), adminId),
    ]);
    const before = await states();
    const page = await listing("?q=Alpha");
    expect(page.occurrences[0].demand).toEqual({
      physical: { confirmed: 1, pending: 1, waitlisted: 1, preferences: 2 },
      remote: { confirmed: 1, pending: 1, waitlisted: 1, preferences: 1 },
    });
    const response = await request(`/agenda/occurrences/${alpha}/room-recommendations`);
    expect(response.status, await response.clone().text()).toBe(200);
    const recommendation = roomRecommendationsResponseSchema.parse(await response.json());
    for (const mode of ["physical", "remote"] as const)
      expect(recommendation.demand[mode]).toMatchObject(page.occurrences[0].demand[mode]);
    expect(recommendation.demand.physical.occupied).toBe(2);
    expect(await states()).toEqual(before);
  });

  it("retains pinned senior block duties and private cross-event conflicts in room recommendations", async () => {
    const roomId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,'Candidate room',20)")
      .bind(roomId, eventId)
      .run();
    const configured = await request(
      "/agenda/staffing",
      "POST",
      agendaStaffingSchema.parse({
        expectedRevision: revision,
        blocks: [
          {
            id: "authored-opening",
            name: "Senior door duty",
            roomId,
            startAt: "2026-12-02T11:00:00.000Z",
            endAt: "2026-12-02T12:00:00.000Z",
            roles: ["door"],
          },
        ],
        staffingRoles: [{ id: "door", name: "Door operator" }],
        staffingPosts: [{ id: "north-door", name: "North entrance", roomId }],
        staffingRequirements: [
          {
            id: "senior-door",
            blockId: "authored-opening",
            roleId: "door",
            postId: "north-door",
            idealCount: 1,
            seniority: "senior",
            attendanceMode: "physical",
          },
        ],
        staffingPositions: [{ id: "senior-door-position", requirementId: "senior-door", index: 1 }],
        roleMembers: [
          {
            userId: adminId,
            displayName: "Senior operator",
            availableFrom: null,
            availableUntil: null,
            maxMinutes: null,
            roles: ["door"],
            seniority: "senior",
            attendanceMode: "physical",
          },
        ],
        assignments: [
          {
            positionId: "senior-door-position",
            blockId: "authored-opening",
            role: "door",
            postId: "north-door",
            userId: adminId,
            pinned: true,
            origin: "manual",
          },
        ],
      }),
    );
    expect(configured.status, await configured.clone().text()).toBe(200);
    const staffed = agendaSnapshotSchema.parse(await configured.json());
    expect(staffed.staffingReport?.coverage[0]).toMatchObject({ assignedCount: 1, missingCount: 0 });
    expect(staffed.staffingReport?.people.find((person) => person.userId === adminId)).toMatchObject({
      minutes: 60,
      pinnedCount: 1,
    });
    await participation(alpha, "reserved");
    await env.DB.prepare("INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id) VALUES(?,?)")
      .bind(alpha, adminId)
      .run();
    const readRecommendations = async () => {
      const response = await request(`/agenda/occurrences/${alpha}/room-recommendations`);
      expect(response.status, await response.clone().text()).toBe(200);
      return roomRecommendationsResponseSchema.parse(await response.json());
    };
    expect((await readRecommendations()).recommendations.find((room) => room.roomId === roomId)?.fit).toBe("fits");
    const foreignEvent = crypto.randomUUID(),
      foreignOccurrence = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO events(id,slug,name,timezone,visibility,created_at,updated_at) VALUES(?,'private-duty-conflict','Confidential board meeting','UTC','invitation_only',?,?)",
      ).bind(foreignEvent, nowIso(), nowIso()),
      env.DB.prepare(
        "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at) VALUES(?,?,'Confidential merger discussion','2026-12-01T09:00:00.000Z','2026-12-01T10:00:00.000Z')",
      ).bind(foreignOccurrence, foreignEvent),
      env.DB.prepare("INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id) VALUES(?,?)").bind(
        foreignOccurrence,
        adminId,
      ),
    ]);
    const before = await states();
    const result = await readRecommendations();
    expect(result.demand.physical).toMatchObject({ confirmed: 1, occupied: 1 });
    expect(result.recommendations.find((room) => room.roomId === roomId)).toMatchObject({
      fit: "unavailable",
      reasons: ["A credited person has conflicting cross-event or meeting availability; details remain private."],
    });
    expect(JSON.stringify(result)).not.toContain("Confidential");
    expect(await states()).toEqual(before);
    const unchanged = agendaSnapshotSchema.parse(await (await request("/agenda")).json());
    expect(unchanged.assignments).toEqual(staffed.assignments);
    expect(unchanged.staffingReport?.people).toEqual(staffed.staffingReport?.people);
    expect(unchanged.staffingRequirements).toEqual(staffed.staffingRequirements);
    expect(unchanged.staffingPositions).toEqual(staffed.staffingPositions);
  });

  it("bounds aggregation to the server-selected page and excludes foreign events without per-row queries", async () => {
    await participation(alpha, "reserved");
    await participation(beta, "waitlisted");
    const foreignEvent = crypto.randomUUID(),
      foreignOccurrence = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO events(id,slug,name,timezone,created_at,updated_at) VALUES(?,'foreign-demand','Foreign','UTC',?,?)",
      ).bind(foreignEvent, nowIso(), nowIso()),
      env.DB.prepare("INSERT INTO event_agenda_occurrences(id,event_id,title) VALUES(?,?,'Foreign session')").bind(
        foreignOccurrence,
        foreignEvent,
      ),
    ]);
    await participation(foreignOccurrence, "reserved", "physical", false, "none", foreignEvent);
    const profile = profileD1Flow(env.DB);
    const response = await request("/agenda/occurrences?limit=1&sort=title", "GET", undefined, token, {
      ...env,
      DB: profile.db,
    });
    expect(response.status).toBe(200);
    const first = agendaOccurrenceListSchema.parse(await response.json());
    expect(first.page).toMatchObject({ total: 2, hasMore: true });
    expect(first.occurrences.map((item) => item.id)).toEqual([alpha]);
    expect(first.occurrences[0].demand.physical).toEqual({ confirmed: 1, pending: 0, waitlisted: 0, preferences: 0 });
    const measured = await profile.report();
    expect(
      measured.queries.filter((query) =>
        query.sql.includes("GROUP BY participation.occurrence_id,participation.attendance_mode"),
      ),
    ).toHaveLength(1);
    const last = await listing("?limit=1&sort=title&offset=1");
    expect(last.page.hasMore).toBe(false);
    expect(last.occurrences[0].demand.physical).toEqual({ confirmed: 0, pending: 0, waitlisted: 1, preferences: 0 });
    expect((await listing("?q=Missing")).occurrences).toEqual([]);
    expect((await listing("?offset=2")).occurrences).toEqual([]);
  });

  it("reflects mounted save, reservation, unsave and cancellation transitions without mutating on reads", async () => {
    const published = await request("/agenda/publications", "POST", { expectedRevision: revision });
    expect(published.status, await published.clone().text()).toBe(200);
    const userId = await insertUser(env.DB);
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, userId, crypto.randomUUID(), nowIso(), nowIso())
      .run();
    const attendeeToken = await createAdminSession(env.DB, userId, crypto.randomUUID());
    for (const [action, confirmed, preferences] of [
      ["save", 0, 1],
      ["reserve", 1, 1],
      ["unsave", 1, 0],
      ["cancel", 0, 0],
    ] as const) {
      const displayed = await request(
        `/agenda/participation?occurrenceId=${beta}&limit=1`,
        "GET",
        undefined,
        attendeeToken,
      );
      expect(displayed.status, await displayed.clone().text()).toBe(200);
      const [shown] = personalAgendaResponseSchema.parse(await displayed.json()).sessions;
      expect(shown?.id).toBe(beta);
      const changed = await request(
        `/agenda/${beta}/participation`,
        "PUT",
        sessionParticipationRequestSchema.parse({
          action,
          attendanceMode: "physical",
          ...(action === "reserve" ? { expectedPublishedRevision: shown!.publishedRevision } : {}),
        }),
        attendeeToken,
      );
      expect(changed.status, await changed.clone().text()).toBe(200);
      const before = await states();
      const row = (await listing("?q=Beta")).occurrences[0];
      expect(row.demand.physical).toEqual({ confirmed, pending: 0, waitlisted: 0, preferences });
      expect(await states()).toEqual(before);
    }
  });

  it("requires real live agenda authorization and refuses another event's granted reader", async () => {
    expect((await request("/agenda/occurrences", "GET", undefined, "")).status).toBe(401);
    const reader = await insertUser(env.DB);
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:read','event',?,?)",
    )
      .bind(crypto.randomUUID(), reader, eventId, nowIso())
      .run();
    const readerToken = await createAdminSession(env.DB, reader, crypto.randomUUID());
    expect((await request("/agenda/occurrences", "GET", undefined, readerToken)).status).toBe(200);
    const foreignEvent = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,created_at,updated_at) VALUES(?,'foreign-reader-demand','Foreign','UTC',?,?)",
    )
      .bind(foreignEvent, nowIso(), nowIso())
      .run();
    const foreign = await callApi(env, "/api/v1/events/foreign-reader-demand/agenda/occurrences", {
      headers: { authorization: `Bearer ${readerToken}` },
    });
    expect(foreign.status).toBe(403);
    const before = await states();
    await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(nowIso(), reader).run();
    expect((await request("/agenda/occurrences", "GET", undefined, readerToken)).status).toBe(401);
    expect(await states()).toEqual(before);
  });
});
