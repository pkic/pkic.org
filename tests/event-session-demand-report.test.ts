import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { encodeBoundedCsv } from "../functions/_lib/csv";
import { sessionDemandReportResponseSchema } from "../assets/shared/schemas/event-session-demand-report";
import {
  eventSessionDemandReport,
  exportSessionDemandReport,
} from "../functions/_lib/services/event-participation/session-demand-report";
import { readSessionDemand } from "../functions/_lib/services/event-participation/session-demand";
import { createUserBackedAuthAdmin } from "../functions/_lib/auth/admin-identity";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { mutateBeforeNextBatch, mutateBeforeMatchingQuery } from "./helpers/database-races";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";

let eventId: string, actor: UserBackedAuthAdmin, token: string;
let alpha: string, beta: string, unscheduled: string, draft: string, roomA: string, roomB: string;
const now = "2026-10-07T12:00:00.000Z";
async function request(query = "", csv = false, authorization = token) {
  return callApi(env, `/api/v1/events/pqc-2026/agenda/reports/demand${csv ? "/exports" : ""}${query}`, {
    headers: authorization ? { authorization: `Bearer ${authorization}` } : {},
  });
}
async function report(query = "") {
  const response = await request(query);
  expect(response.status, await response.clone().text()).toBe(200);
  return sessionDemandReportResponseSchema.parse(await response.json());
}
async function participation(
  occurrenceId: string,
  status: string,
  saved = false,
  mode = "physical",
  roomId: string | null = null,
) {
  const userId = await insertUser(env.DB);
  await env.DB.prepare(
    `INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,saved,room_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(crypto.randomUUID(), eventId, occurrenceId, userId, mode, status, Number(saved), roomId, now, now)
    .run();
  return userId;
}
async function revokeAdministrator() {
  await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=? AND role_id='role-admin'")
    .bind(new Date().toISOString(), actor.id)
    .run();
}
async function grantRead(targetEventId = eventId) {
  await env.DB.prepare(
    "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:read','event',?,?)",
  )
    .bind(crypto.randomUUID(), actor.id, targetEventId, now)
    .run();
}
async function exportedAuditCount() {
  return (await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM audit_log WHERE action='agenda.session_demand.exported'",
  ).first<{ total: number }>())!.total;
}

describe("Published session favorites and capacity demand report", () => {
  beforeEach(async () => {
    await resetDb();
    const fixture = await seedEventAndAdmin(env.DB);
    eventId = fixture.eventId;
    token = await createAdminSession(env.DB, fixture.admin.id, crypto.randomUUID());
    const session = await env.DB.prepare("SELECT id FROM sessions WHERE user_id=?")
      .bind(fixture.admin.id)
      .first<{ id: string }>();
    actor = createUserBackedAuthAdmin({ ...fixture.admin, sessionId: session!.id });
    alpha = crypto.randomUUID();
    beta = crypto.randomUUID();
    unscheduled = crypto.randomUUID();
    draft = crypto.randomUUID();
    roomA = crypto.randomUUID();
    roomB = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,2,1,?)",
      ).bind(eventId, now),
      ...[
        [roomA, "Draft room A"],
        [roomB, "Draft room B"],
      ].map(([id, name]) =>
        env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,?,999)").bind(
          id,
          eventId,
          name,
        ),
      ),
      ...[alpha, beta, unscheduled, draft].map((id) =>
        env.DB.prepare(
          "INSERT INTO event_agenda_occurrences(id,event_id,title,capacity) VALUES(?,?,'Unpublished draft title',999)",
        ).bind(id, eventId),
      ),
    ]);
    const occurrences = [
      {
        id: alpha,
        title: "=Planning favorites",
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
        roomId: roomA,
        additionalRoomIds: [roomB],
        admissionPolicy: "reservation",
        accessPolicy: "invitation",
        capacity: 4,
        remoteCapacity: 6,
        visibility: "public",
      },
      {
        id: beta,
        title: "Night approval",
        startAt: "2026-12-01T23:30:00.000Z",
        endAt: "2026-12-02T00:30:00.000Z",
        roomId: roomA,
        additionalRoomIds: [],
        admissionPolicy: "approval",
        accessPolicy: "open",
        capacity: null,
        remoteCapacity: 2,
        visibility: "public",
      },
      {
        id: unscheduled,
        title: "Unscheduled preference",
        startAt: null,
        endAt: null,
        roomId: null,
        additionalRoomIds: [],
        admissionPolicy: "preference",
        accessPolicy: "open",
        capacity: null,
        remoteCapacity: null,
        visibility: "public",
      },
    ];
    await env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,1,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        eventId,
        JSON.stringify({
          timeZone: "Europe/Amsterdam",
          occurrences,
          rooms: [
            { id: roomA, name: "Published room A", capacity: 2 },
            { id: roomB, name: "Published room B", capacity: 3 },
          ],
        }),
        actor.id,
        now,
      )
      .run();
    const reserved = await participation(alpha, "reserved", true);
    await participation(alpha, "reserved", false, "physical", roomB);
    await participation(alpha, "approval_pending", true);
    await participation(alpha, "waitlisted");
    await participation(alpha, "saved"); // Legacy saved state remains a favorite, independently of its saved flag.
    await participation(alpha, "canceled", true);
    await participation(alpha, "saved", true, "remote");
    await participation(alpha, "reserved", true, "remote");
    await participation(beta, "saved", true);
    await participation(draft, "saved", true);
    const operational = await insertUser(env.DB);
    await env.DB.batch(
      [reserved, operational].map((userId, index) =>
        env.DB.prepare(
          `INSERT INTO event_agenda_operational_people(event_id,revision,occurrence_id,user_id,attendance_mode,room_id,sources_json)
      VALUES(?,1,?,?,'physical',?,'[]')`,
        ).bind(eventId, alpha, userId, index === 0 ? roomA : roomB),
      ),
    );
    for (const expiresAt of ["2099-01-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]) {
      const held = await insertUser(env.DB);
      await env.DB.prepare(
        `INSERT INTO agenda_session_holds(id,event_id,occurrence_id,user_id,attendance_mode,room_id,expires_at,created_by,reason_code,created_at)
        VALUES(?,?,?,?,'physical',?,?,?,'organizer_hold','2026-09-01T00:00:00.000Z')`,
      )
        .bind(crypto.randomUUID(), eventId, alpha, held, roomA, expiresAt, actor.id)
        .run();
    }
  });

  it("counts all canonical favorites alongside bookings without an observed-attendance census or draft capacity", async () => {
    const data = await report();
    expect(data.report).toMatchObject({
      scheduleBasis: "published_agenda",
      publishedRevision: 1,
      timeZone: "Europe/Amsterdam",
    });
    expect(data.page.total).toBe(6);
    const physical = data.sessions.find((row) => row.occurrenceId === alpha && row.attendanceMode === "physical")!;
    expect(physical).toMatchObject({
      title: "=Planning favorites",
      preferences: 3,
      confirmed: 2,
      pending: 1,
      waitlisted: 1,
      occupied: 4,
      sessionCapacity: 4,
      admissionPolicy: "reservation",
      accessPolicy: "invitation",
    });
    expect(physical.locations).toEqual(
      expect.arrayContaining([
        { id: roomA, name: "Published room A", capacity: 2, occupied: 2 },
        { id: roomB, name: "Published room B", capacity: 3, occupied: 2 },
      ]),
    );
    expect(data.sessions.find((row) => row.occurrenceId === alpha && row.attendanceMode === "remote")).toMatchObject({
      preferences: 2,
      confirmed: 1,
      occupied: 1,
      sessionCapacity: 6,
      locations: [],
    });
    expect(data.sessions.filter((row) => row.occurrenceId === unscheduled)).toHaveLength(2);
    expect(JSON.stringify(data)).not.toContain("Unpublished draft");
    const canonical = await readSessionDemand(env.DB, eventId, [alpha]);
    expect(canonical.get(alpha)?.physical).toEqual({ preferences: 3, confirmed: 2, pending: 1, waitlisted: 1 });
  });

  it("sorts demand before pagination and applies timezone-day, room, policy and attendance-mode filters in SQL", async () => {
    const first = await report("?sort=-preferences&limit=1");
    expect(first.sessions[0]).toMatchObject({ occurrenceId: alpha, attendanceMode: "physical", preferences: 3 });
    expect(first.page).toEqual({ limit: 1, offset: 0, total: 6, hasMore: true });
    const second = await report("?sort=-preferences&limit=1&offset=1");
    expect(second.sessions[0]).toMatchObject({ occurrenceId: alpha, attendanceMode: "remote" });
    const localDay = await report("?dayDate=2026-12-02&attendanceMode=physical");
    expect(localDay.sessions.map((row) => row.occurrenceId)).toEqual([beta]);
    const room = await report(`?roomId=${roomB}&admissionPolicy=reservation&accessPolicy=invitation&q=PLANNING`);
    expect(room.sessions).toHaveLength(1);
    expect(room.sessions[0].attendanceMode).toBe("physical");
    expect((await report(`?roomId=${roomB}&attendanceMode=remote`)).page.total).toBe(0);
    expect((await request("?sort=arbitrary_sql")).status).toBe(400);
    expect((await request("?dayDate=2026-02-30")).status).toBe(400);
  });

  it("exports the complete filtered population with formula escaping and separate room constraints", async () => {
    const page = await report("?q=planning&limit=1");
    expect(page.page.total).toBe(2);
    const response = await request("?q=planning&sort=-preferences", true);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-type")).toContain("text/csv");
    const csv = await response.text();
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv).toContain("'=Planning favorites");
    expect(csv).toContain("sessionCapacity,locations,scheduleBasis,publishedRevision,timeZone");
    expect(csv).toContain("published_agenda,1,Europe/Amsterdam");
    const expectedPhysical = encodeBoundedCsv(
      [
        [
          "physical",
          3,
          2,
          1,
          1,
          4,
          4,
          JSON.stringify([
            { id: roomA, name: "Published room A", capacity: 2, occupied: 2 },
            { id: roomB, name: "Published room B", capacity: 3, occupied: 2 },
          ]),
        ],
      ],
      20000,
    );
    const expectedRemote = encodeBoundedCsv([["remote", 2, 1, 0, 0, 1, 6, "[]"]], 20000);
    expect(csv).toContain(`,${expectedPhysical},published_agenda,1,Europe/Amsterdam,`);
    expect(csv).toContain(`,${expectedRemote},published_agenda,1,Europe/Amsterdam,`);
    expect((await request("?limit=1", true)).status).toBe(400);
    expect(await exportedAuditCount()).toBe(1);
  });

  it("keeps a foreign event's published favorite and an occurrence filter outside this event's population", async () => {
    const foreignEvent = crypto.randomUUID(),
      foreignOccurrence = crypto.randomUUID();
    const userId = await insertUser(env.DB);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO events(id,slug,name,timezone,created_at,updated_at) VALUES(?,?,'Foreign','UTC',?,?)",
      ).bind(foreignEvent, `foreign-${foreignEvent}`, now, now),
      env.DB.prepare(
        "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,1,1,?)",
      ).bind(foreignEvent, now),
      env.DB.prepare("INSERT INTO event_agenda_occurrences(id,event_id,title) VALUES(?,?,'Foreign favorite')").bind(
        foreignOccurrence,
        foreignEvent,
      ),
      env.DB.prepare(
        "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,1,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        foreignEvent,
        JSON.stringify({
          timeZone: "UTC",
          rooms: [],
          occurrences: [
            {
              id: foreignOccurrence,
              title: "Foreign favorite",
              startAt: null,
              endAt: null,
              roomId: null,
              admissionPolicy: "preference",
              accessPolicy: "open",
              capacity: null,
              remoteCapacity: null,
            },
          ],
        }),
        actor.id,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,saved,created_at,updated_at) VALUES(?,?,?,?,'physical','saved',1,?,?)",
      ).bind(crypto.randomUUID(), foreignEvent, foreignOccurrence, userId, now, now),
    ]);
    const data = await report();
    expect(data.page.total).toBe(6);
    expect(JSON.stringify(data)).not.toContain("Foreign favorite");
    expect((await report(`?occurrenceId=${foreignOccurrence}`)).page.total).toBe(0);
    const csv = await (await request(`?occurrenceId=${foreignOccurrence}`, true)).text();
    expect(csv.split("\r\n")).toHaveLength(1);
    expect(csv).not.toContain("Foreign favorite");
  });

  it("rejects oversized complete exports without returning partial CSV or recording a successful export", async () => {
    await expect(
      exportSessionDemandReport(env.DB, eventId, actor, { q: "planning" }, { maxRows: 1, maxBytes: 100000 }),
    ).rejects.toMatchObject({ status: 413, code: "SESSION_DEMAND_EXPORT_ROW_LIMIT" });
    await expect(
      exportSessionDemandReport(env.DB, eventId, actor, { attendanceMode: "physical" }, { maxRows: 100, maxBytes: 10 }),
    ).rejects.toMatchObject({ status: 413, code: "CSV_EXPORT_TOO_LARGE" });
    expect(await exportedAuditCount()).toBe(0);
  });

  it("requires exact live agenda-read access, exposes no people and lets a read-only organizer export", async () => {
    expect((await request("", false, "")).status).toBe(401);
    await revokeAdministrator();
    const inactive = await request();
    expect(inactive.status).toBe(401);
    expect(await inactive.json()).toMatchObject({ error: { code: "AUTH_INVALID" } });
    expect(await exportedAuditCount()).toBe(0);
    const foreignEvent = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,created_at,updated_at) VALUES(?,?,'Foreign','UTC',?,?)",
    )
      .bind(foreignEvent, `foreign-${foreignEvent}`, now, now)
      .run();
    await grantRead(foreignEvent);
    expect((await request()).status).toBe(403);
    expect((await request("", true)).status).toBe(403);
    await grantRead();
    const data = await report();
    expect(JSON.stringify(data)).not.toContain("userId");
    expect(JSON.stringify(data)).not.toContain("email");
    expect((await request("", true)).status).toBe(200);
  });

  it("rechecks permission atomically before demand reads", async () => {
    const raced = mutateBeforeNextBatch(env.DB, revokeAdministrator);
    await expect(eventSessionDemandReport(raced, eventId, actor, {})).rejects.toMatchObject({
      status: 403,
      code: "SESSION_DEMAND_PERMISSION_CHANGED",
    });
    expect(await exportedAuditCount()).toBe(0);
  });

  it("rechecks revoked permission before releasing CSV and keeps its audit atomic", async () => {
    const raced = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("INSERT INTO audit_log"),
      revokeAdministrator,
    );
    await expect(exportSessionDemandReport(raced, eventId, actor, { q: "planning" })).rejects.toMatchObject({
      status: 403,
      code: "SESSION_DEMAND_PERMISSION_CHANGED",
    });
    expect(await exportedAuditCount()).toBe(0);
    const inactive = await request("", true);
    expect(inactive.status).toBe(401);
    expect(inactive.headers.get("content-type")).not.toContain("text/csv");
    expect(await inactive.json()).toMatchObject({ error: { code: "AUTH_INVALID" } });
  });

  it("refuses an expired session at the mounted report and CSV boundaries", async () => {
    await env.DB.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id=?")
      .bind(actor.id)
      .run();
    expect((await request()).status).toBe(401);
    expect((await request("", true)).status).toBe(401);
    expect(await exportedAuditCount()).toBe(0);
  });

  it("labels unpublished state as an empty published agenda and refuses a publication switch during a report", async () => {
    const raced = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE event_agenda_state SET published_revision=NULL WHERE event_id=?").bind(eventId).run(),
    );
    await expect(eventSessionDemandReport(raced, eventId, actor, {})).rejects.toMatchObject({
      status: 409,
      code: "SESSION_DEMAND_PUBLICATION_CHANGED",
    });
    const empty = await report();
    expect(empty.sessions).toEqual([]);
    expect(empty.page.total).toBe(0);
    expect(empty.report).toMatchObject({ scheduleBasis: "published_agenda", publishedRevision: null });
  });

  it("keeps database calls bounded as the report page grows", async () => {
    const small = profileD1Flow(env.DB);
    await eventSessionDemandReport(small.db, eventId, actor, { limit: 1 });
    const large = profileD1Flow(env.DB);
    await eventSessionDemandReport(large.db, eventId, actor, { limit: 200 });
    const [smallProof, largeProof] = await Promise.all([small.report(), large.report()]);
    expect(largeProof.statements).toBe(smallProof.statements);
    expect(largeProof.roundTrips).toBe(smallProof.roundTrips);
    expect(largeProof.roundTrips).toBeLessThanOrEqual(4);
  });
});
