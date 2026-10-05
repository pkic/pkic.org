import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  agendaOccurrencePatchSchema,
  agendaRevisionSchema,
  agendaRoomCreateSchema,
  agendaSnapshotSchema,
} from "../assets/shared/schemas/event-agenda";
import {
  agendaContentCreateSchema,
  agendaContentPlacementSchema,
  agendaContentPlacementResponseSchema,
  agendaContentSchema,
} from "../assets/shared/schemas/event-agenda-content";
import { personalAgendaResponseSchema } from "../assets/shared/schemas/event-personal-agenda";
import {
  agendaScheduleApplySchema,
  agendaScheduleProposalSchema,
  agendaScheduleReviewSchema,
} from "../assets/shared/schemas/event-agenda-schedule";
import { apiErrorPayloadSchema } from "../assets/shared/schemas/api-common";
import {
  sessionParticipationRequestSchema,
  sessionParticipationResponseSchema,
} from "../assets/shared/schemas/event-participation-scanning";
import { sessionReviewRequestSchema } from "../assets/shared/schemas/route-contracts-session-participation";
import { sessionHoldRequestSchema, sessionHoldResponseSchema } from "../assets/shared/schemas/event-session-holds";
import type { DatabaseLike } from "../functions/_lib/types";
import { promoteSessionWaitlist } from "../functions/_lib/services/event-participation/waitlist";
import { integratedPilot } from "./helpers/agenda-integrated-pilot";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { insertIndividualMember } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);

/** Arm only once the domain write exists, after mounted authorization/read batches. */
function allocationGate(prefix: string) {
  const gate = gateNextBatch(env.DB);
  let prepared = false;
  const db: DatabaseLike = {
    prepare(sql) {
      if (sql.startsWith(prefix)) prepared = true;
      return env.DB.prepare(sql);
    },
    batch: (statements) => (prepared ? gate.db : env.DB).batch(statements),
  };
  return { ...gate, db };
}
async function reached(gate: ReturnType<typeof allocationGate>, pending: Promise<Response>) {
  await Promise.race([
    gate.reached,
    pending.then((response) => {
      throw new Error(`Request ended before its domain write: ${response.status}`);
    }),
  ]);
}
async function expectParticipation(response: Response, status: "reserved" | "waitlisted" | "approval_pending") {
  expect(response.status, await response.clone().text()).toBe(200);
  expect(sessionParticipationResponseSchema.parse(await response.json()).status).toBe(status);
}
async function effects() {
  const tables = [
    "agenda_session_participations",
    "agenda_session_holds",
    "agenda_session_invitation_audit",
    "agenda_calendar_entries",
    "agenda_participation_jobs",
    "audit_log",
    "email_outbox",
    "agenda_push_outbox",
    "event_agenda_state",
    "event_agenda_occurrences",
    "event_agenda_occurrence_rooms",
    "event_agenda_occurrence_speakers",
    "event_agenda_rooms",
    "event_agenda_publications",
    "site_publication_requests",
  ];
  return Promise.all(tables.map((table) => queryAll(env.DB, `SELECT * FROM ${table} ORDER BY rowid`)));
}

async function fixture(policy: "reservation" | "approval" = "reservation", capacity = 1) {
  const pilot = await integratedPilot();
  const base = "/api/v1/events/pqc-2026/agenda";
  let snapshot = await pilot.api(base, agendaSnapshotSchema);
  const rooms: string[] = [];
  for (const name of ["First room", "Second room"]) {
    snapshot = await pilot.api(
      `${base}/rooms`,
      agendaSnapshotSchema,
      agendaRoomCreateSchema.parse({
        expectedRevision: snapshot.revision,
        name,
        capacity,
        setupMinutes: 0,
      }),
    );
    rooms.push(snapshot.rooms.find((room) => room.name === name)!.id);
  }
  const content = await pilot.api(
    `${base}/contents`,
    agendaContentSchema,
    agendaContentCreateSchema.parse({
      expectedRevision: snapshot.revision,
      content: {
        title: "Repeated capacity workshop",
        description: "A substantive workshop on interoperable certificate operations and lifecycle management.",
        kind: "session",
        speakerUserIds: [],
      },
    }),
  );
  snapshot = await pilot.api(base, agendaSnapshotSchema);
  const occurrences: string[] = [];
  for (let index = 0; index < 2; index++) {
    const placement = await pilot.api(
      `${base}/contents/${content.id}/placements`,
      agendaContentPlacementResponseSchema,
      agendaContentPlacementSchema.parse({ expectedRevision: snapshot.revision, copyAsNew: false }),
    );
    const id = placement.occurrenceId;
    occurrences.push(id);
    snapshot = await pilot.api(
      `${base}/occurrences/${id}`,
      agendaSnapshotSchema,
      agendaOccurrencePatchSchema.parse({
        expectedRevision: placement.agenda.revision,
        startAt: `2026-12-01T${index === 0 ? "09" : "11"}:00:00.000Z`,
        endAt: `2026-12-01T${index === 0 ? "10" : "12"}:00:00.000Z`,
        roomId: rooms[index],
        admissionPolicy: policy,
        capacity: null,
        remoteCapacity: 1,
        visibility: "public",
      }),
      "PATCH",
    );
  }
  snapshot = await pilot.api(
    `${base}/publications`,
    agendaSnapshotSchema,
    agendaRevisionSchema.parse({ expectedRevision: snapshot.revision }),
  );
  const people = [{ userId: pilot.person.userId, token: pilot.personToken }];
  for (let index = 0; index < 2; index++) {
    const person = await insertIndividualMember(env.DB);
    people.push({
      userId: person.userId,
      token: await createMemberSession(
        env.DB,
        person.userId,
        crypto.randomUUID(),
        env.INTERNAL_SIGNING_SECRET,
        person.identityId,
      ),
    });
  }
  const now = new Date().toISOString();
  for (const person of people)
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(crypto.randomUUID(), pilot.eventId, person.userId, crypto.randomUUID(), now, now)
      .run();
  const adminToken = await createAdminSession(env.DB, pilot.operatorId, crypto.randomUUID());
  async function request(path: string, body: unknown, token: string, db = env.DB as DatabaseLike, method = "PUT") {
    return callApi({ ...env, DB: db }, `${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  async function book(
    personIndex: number,
    occurrenceIndex = 0,
    action: "reserve" | "request" = "reserve",
    mode: "physical" | "remote" = "physical",
    db: DatabaseLike = env.DB,
  ) {
    const person = people[personIndex]!;
    const shown = await pilot.api(
      `${base}/participation?limit=10`,
      personalAgendaResponseSchema,
      undefined,
      "GET",
      200,
      person.token,
    );
    const session = shown.sessions.find((row) => row.id === occurrences[occurrenceIndex])!;
    return request(
      `/${session.id}/participation`,
      sessionParticipationRequestSchema.parse({
        action,
        attendanceMode: mode,
        expectedPublishedRevision: session.publishedRevision,
      }),
      person.token,
      db,
    );
  }
  async function review(db: DatabaseLike = env.DB) {
    return request(
      `/${occurrences[0]}/participation/${people[0]!.userId}`,
      sessionReviewRequestSchema.parse({ decision: "approve" }),
      adminToken,
      db,
    );
  }
  async function draft(body: unknown, path: string, db: DatabaseLike = env.DB, method = "PATCH") {
    return request(path, body, adminToken, db, method);
  }
  const rows = () =>
    queryAll<{
      id: string;
      occurrence_id: string;
      user_id: string;
      status: string;
      attendance_mode: string;
      room_id: string | null;
      allocation_revision: number;
    }>(
      env.DB,
      "SELECT id,occurrence_id,user_id,status,attendance_mode,room_id,allocation_revision FROM agenda_session_participations ORDER BY occurrence_id,user_id",
    );
  return { pilot, base, rooms, occurrences, content, snapshot, people, request, book, review, draft, rows, adminToken };
}

describe("Prepared allocation transitions retain live capacity invariants", () => {
  it("commits one of two approvals prepared from the same pending row without loser effects", async () => {
    const f = await fixture("approval");
    await expectParticipation(await f.book(0, 0, "request"), "approval_pending");
    const first = allocationGate("UPDATE agenda_session_participations AS pending"),
      second = allocationGate("UPDATE agenda_session_participations AS pending");
    const a = f.review(first.db),
      b = f.review(second.db);
    try {
      await Promise.all([reached(first, a), reached(second, b)]);
      first.release();
      await expectParticipation(await a, "reserved");
      const committed = await effects();
      second.release();
      const loser = await b;
      expect(loser.status).toBe(409);
      expect(apiErrorPayloadSchema.parse(await loser.json()).error.code).toBe("SESSION_APPROVAL_CONFLICT");
      expect(await effects()).toEqual(committed);
      expect(
        await queryAll(env.DB, "SELECT actor_id,action FROM audit_log WHERE action='session_participation_approved'"),
      ).toEqual([{ actor_id: f.pilot.operatorId, action: "session_participation_approved" }]);
      expect((await f.rows()).filter((row) => row.status === "reserved")).toHaveLength(1);
    } finally {
      first.release();
      second.release();
    }
  });

  it("preserves physical allocation and effects when a free remote destination fills after preparation", async () => {
    const f = await fixture();
    await expectParticipation(await f.book(0), "reserved");
    for (const person of f.people.slice(0, 2))
      await env.DB.prepare("UPDATE registrations SET attendance_type='virtual' WHERE event_id=? AND user_id=?")
        .bind(f.pilot.eventId, person.userId)
        .run();
    const gate = allocationGate("WITH actor AS");
    const pending = f.book(0, 0, "reserve", "remote", gate.db);
    try {
      await reached(gate, pending);
      await expectParticipation(await f.book(1, 0, "reserve", "remote"), "reserved");
      const committed = await effects();
      gate.release();
      const loser = await pending;
      expect(loser.status).toBe(409);
      expect(apiErrorPayloadSchema.parse(await loser.json()).error.code).toBe("SESSION_PARTICIPATION_CONFLICT");
      expect(await effects()).toEqual(committed);
      const rows = await f.rows();
      expect(rows).toHaveLength(2);
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            user_id: f.people[0]!.userId,
            status: "reserved",
            attendance_mode: "physical",
            room_id: f.rooms[0],
          }),
          expect.objectContaining({
            user_id: f.people[1]!.userId,
            status: "reserved",
            attendance_mode: "remote",
            room_id: null,
          }),
        ]),
      );
    } finally {
      gate.release();
    }
  });

  it("promotes FIFO once when two workers prepared the same candidate after hold expiry", async () => {
    const f = await fixture();
    const hold = await f.pilot.api(
      `${f.base}/${f.occurrences[0]}/holds`,
      sessionHoldResponseSchema,
      sessionHoldRequestSchema.parse({
        userId: f.people[2]!.userId,
        attendanceMode: "physical",
        reasonCode: "staff",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    );
    await expectParticipation(await f.book(0), "waitlisted");
    await expectParticipation(await f.book(1), "waitlisted");
    const fifo = await queryAll<{ user_id: string }>(
      env.DB,
      "SELECT user_id FROM agenda_session_participations WHERE status='waitlisted' ORDER BY COALESCE(waitlisted_at,created_at),id",
    );
    const expiredAt = new Date(Date.now() - 1).toISOString();
    const storedHold = await env.DB.prepare("SELECT created_at FROM agenda_session_holds WHERE id=?")
      .bind(hold.id)
      .first<{ created_at: string }>();
    expect(storedHold!.created_at < expiredAt).toBe(true);
    expect(expiredAt < new Date().toISOString()).toBe(true);
    await env.DB.prepare("UPDATE agenda_session_holds SET expires_at=? WHERE id=?").bind(expiredAt, hold.id).run();
    const first = allocationGate("UPDATE agenda_session_participations AS waiting"),
      second = allocationGate("UPDATE agenda_session_participations AS waiting");
    const a = promoteSessionWaitlist(first.db, f.pilot.eventId),
      b = promoteSessionWaitlist(second.db, f.pilot.eventId);
    try {
      await Promise.all([
        Promise.race([
          first.reached,
          a.then(() => {
            throw new Error("First promotion ended before allocation");
          }),
        ]),
        Promise.race([
          second.reached,
          b.then(() => {
            throw new Error("Second promotion ended before allocation");
          }),
        ]),
      ]);
      first.release();
      expect((await a).promoted).toBe(1);
      const committed = await effects();
      second.release();
      expect((await b).promoted).toBe(0);
      expect(await effects()).toEqual(committed);
      const rows = await f.rows();
      expect(rows.filter((row) => row.status === "reserved").map((row) => row.user_id)).toEqual([fifo[0]!.user_id]);
      expect(rows.filter((row) => row.status === "waitlisted").map((row) => row.user_id)).toEqual([fifo[1]!.user_id]);
      const mail = await queryAll<{ idempotency_key: string }>(
        env.DB,
        "SELECT idempotency_key FROM email_outbox WHERE template_key='agenda_session_booking'",
      );
      expect(mail).toHaveLength(3);
      expect(new Set(mail.map((row) => row.idempotency_key)).size).toBe(3);
    } finally {
      first.release();
      second.release();
    }
  });

  it("allocates same-content published repeats independently and refuses a later overlapping approved basis", async () => {
    const f = await fixture();
    expect(f.snapshot.occurrences.map((row) => row.contentId)).toEqual([f.content.id, f.content.id]);
    const first = allocationGate("WITH actor AS"),
      second = allocationGate("WITH actor AS");
    const a = f.book(0, 0, "reserve", "physical", first.db),
      b = f.book(0, 1, "reserve", "physical", second.db);
    try {
      await Promise.all([reached(first, a), reached(second, b)]);
      first.release();
      second.release();
      await Promise.all([expectParticipation(await a, "reserved"), expectParticipation(await b, "reserved")]);
      const rows = await f.rows();
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.id)).size).toBe(2);
      expect(new Set(rows.map((row) => row.occurrence_id))).toEqual(new Set(f.occurrences));
      expect(rows.every((row) => row.user_id === f.people[0]!.userId && row.status === "reserved")).toBe(true);
      expect(new Set(rows.map((row) => row.room_id))).toEqual(new Set(f.rooms));
      const mail = await queryAll<{ idempotency_key: string }>(
        env.DB,
        "SELECT idempotency_key FROM email_outbox WHERE template_key='agenda_session_booking'",
      );
      expect(mail).toHaveLength(2);
      expect(new Set(mail.map((row) => row.idempotency_key)).size).toBe(2);
      const entries = await queryAll<{ occurrence_id: string }>(
        env.DB,
        "SELECT occurrence_id FROM agenda_calendar_entries WHERE status='confirmed'",
      );
      expect(entries).toHaveLength(2);
      expect(new Set(entries.map((row) => row.occurrence_id))).toEqual(new Set(f.occurrences));
      const draft = await f.draft(
        agendaOccurrencePatchSchema.parse({
          expectedRevision: f.snapshot.revision,
          startAt: "2026-12-01T09:00:00.000Z",
          endAt: "2026-12-01T10:00:00.000Z",
        }),
        `/occurrences/${f.occurrences[1]}`,
      );
      expect(draft.status, await draft.clone().text()).toBe(200);
      const next = agendaSnapshotSchema.parse(await draft.json());
      const before = await effects();
      const approval = await f.pilot.raw(
        `${f.base}/publications`,
        agendaRevisionSchema.parse({ expectedRevision: next.revision }),
      );
      expect(approval.status).toBe(409);
      expect(apiErrorPayloadSchema.parse(await approval.json()).error.code).toBe("AGENDA_ATTENDEE_OVERLAP");
      expect(await effects()).toEqual(before);
    } finally {
      first.release();
      second.release();
    }
  });

  it.each(["room downsize", "room swap"] as const)(
    "rolls back a prepared %s when approved-pool allocation commits after review",
    async (change) => {
      const f = await fixture("reservation", 2);
      const downsize = change === "room downsize";
      const gate = allocationGate(
        downsize ? "UPDATE event_agenda_rooms SET" : "UPDATE event_agenda_occurrences SET start_at=",
      );
      let pending: Promise<Response>;
      if (downsize) {
        const body = agendaRoomCreateSchema.parse({
          expectedRevision: f.snapshot.revision,
          name: "First room",
          capacity: 1,
          setupMinutes: 0,
        });
        pending = f.draft(body, `/rooms/${f.rooms[0]}`, gate.db, "PUT");
      } else {
        const proposal = agendaScheduleProposalSchema.parse({
          expectedRevision: f.snapshot.revision,
          changes: f.occurrences.map((id, index) => {
            const occurrence = f.snapshot.occurrences.find((row) => row.id === id)!;
            return {
              id,
              startAt: occurrence.startAt,
              endAt: occurrence.endAt,
              roomId: f.rooms[1 - index],
              additionalRoomIds: occurrence.additionalRoomIds,
            };
          }),
        });
        const reviewed = await f.pilot.api(`${f.base}/schedule/reviews`, agendaScheduleReviewSchema, proposal);
        expect(reviewed.affected).toHaveLength(2);
        const body = agendaScheduleApplySchema.parse({ ...proposal, reviewHash: reviewed.reviewHash });
        pending = f.request("/schedule", body, f.adminToken, gate.db, "POST");
      }
      try {
        await reached(gate, pending);
        await expectParticipation(await f.book(0), "reserved");
        if (downsize) await expectParticipation(await f.book(1), "reserved");
        const committed = await effects();
        gate.release();
        const refused = await pending;
        expect(refused.status).toBe(409);
        expect(apiErrorPayloadSchema.parse(await refused.json()).error.code).toBe("AGENDA_AUTHORIZATION_CHANGED");
        expect(await effects()).toEqual(committed);
        const retained = await f.pilot.api(f.base, agendaSnapshotSchema);
        expect(retained.revision).toBe(f.snapshot.revision);
        expect(retained.publishedRevision).toBe(f.snapshot.publishedRevision);
        expect(retained.rooms.find((row) => row.id === f.rooms[0])!.capacity).toBe(2);
        expect(retained.occurrences.find((row) => row.id === f.occurrences[0])!.roomId).toBe(f.rooms[0]);
        expect(retained.occurrences.find((row) => row.id === f.occurrences[1])!.roomId).toBe(f.rooms[1]);
        expect((await f.rows()).every((row) => row.status === "reserved" && row.room_id === f.rooms[0])).toBe(true);
      } finally {
        gate.release();
      }
    },
  );
});
