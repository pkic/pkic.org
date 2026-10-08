import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { personalAgendaResponseSchema } from "../assets/shared/schemas/event-personal-agenda";
import {
  sessionParticipationRequestSchema,
  sessionParticipationResponseSchema,
} from "../assets/shared/schemas/event-participation-scanning";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import type { DatabaseLike, Env } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertIndividualMember } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);
async function fixture(policy: "reservation" | "approval" = "reservation") {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const { userId } = await insertIndividualMember(env.DB);
  const token = await createAdminSession(env.DB, userId, crypto.randomUUID());
  const roomId = crypto.randomUUID(),
    firstId = crypto.randomUUID(),
    secondId = crypto.randomUUID();
  const now = nowIso(),
    start = new Date(Date.now() + 86400000).toISOString(),
    end = new Date(Date.now() + 90000000).toISOString();
  await env.DB.prepare("UPDATE events SET capacity_in_person=100,starts_at=?,ends_at=? WHERE id=?")
    .bind(start, end, eventId)
    .run();
  await env.DB.prepare(
    "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
  )
    .bind(crypto.randomUUID(), eventId, userId, crypto.randomUUID(), now, now)
    .run();
  await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,'Meeting room',4)")
    .bind(roomId, eventId)
    .run();
  for (const id of [firstId, secondId])
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,room_id,admission_policy,capacity) VALUES(?,?,?, ?,?,?,?,3)",
    )
      .bind(id, eventId, id, start, end, roomId, policy)
      .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,0,?)",
  )
    .bind(eventId, now)
    .run();
  const snapshot = await getAgenda(env.DB, eventId, "pqc-2026");
  await env.DB.prepare(
    "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,0,?,?,?)",
  )
    .bind(crypto.randomUUID(), eventId, JSON.stringify(snapshot), userId, now)
    .run();
  const api = (path: string, init?: RequestInit, environment: Env = env) =>
    callApi(environment, `/api/v1/events/pqc-2026/agenda${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...init?.headers },
    });
  const reserve = (body: unknown, occurrenceId = firstId, environment: Env = env) =>
    api(
      `/${occurrenceId}/participation`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      environment,
    );
  const displayed = async () => {
    const response = await api("/participation?limit=10");
    expect(response.status, await response.clone().text()).toBe(200);
    return personalAgendaResponseSchema.parse(await response.json());
  };
  const advance = async (revision = 1) => {
    const next = { ...snapshot, revision, publishedRevision: revision };
    await env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, revision, JSON.stringify(next), userId, nowIso())
      .run();
    await env.DB.prepare("UPDATE event_agenda_state SET revision=?,published_revision=? WHERE event_id=?")
      .bind(revision, revision, eventId)
      .run();
  };
  return {
    eventId,
    userId,
    token,
    roomId,
    firstId,
    secondId,
    api,
    reserve,
    displayed,
    advance,
  };
}
async function effects() {
  return {
    participations: await queryAll(env.DB, "SELECT * FROM agenda_session_participations ORDER BY id"),
    calendar: await queryAll(env.DB, "SELECT * FROM agenda_calendar_entries ORDER BY occurrence_id,user_id"),
    jobs: await queryAll(env.DB, "SELECT * FROM agenda_participation_jobs ORDER BY event_id"),
    audit: await queryAll(env.DB, "SELECT * FROM audit_log ORDER BY id"),
    mail: await queryAll(env.DB, "SELECT * FROM email_outbox ORDER BY id"),
  };
}
const command = (revision: number, action: "reserve" | "request" = "reserve") =>
  sessionParticipationRequestSchema.parse({
    action,
    attendanceMode: "physical",
    expectedPublishedRevision: revision,
  });
describe("displayed published agenda revision at live participation", () => {
  it.each(["reservation", "approval"] as const)(
    "refuses a stale displayed revision for %s without booking effects and accepts explicit refreshed confirmation",
    async (policy) => {
      const f = await fixture(policy);
      const shown = (await f.displayed()).sessions.find((row) => row.id === f.firstId)!;
      expect(shown.publishedRevision).toBe(0);
      await f.advance();
      const before = await effects();
      const action = policy === "approval" ? "request" : "reserve";
      const stale = await f.reserve(command(shown.publishedRevision, action));
      expect(stale.status, await stale.clone().text()).toBe(409);
      expect(await stale.json()).toMatchObject({
        error: { code: "SESSION_PUBLICATION_CHANGED", details: null },
      });
      expect(await effects()).toEqual(before);
      const refreshed = (await f.displayed()).sessions.find((row) => row.id === f.firstId)!;
      expect(refreshed.publishedRevision).toBe(1);
      expect(await effects()).toEqual(before);
      const accepted = await f.reserve(command(refreshed.publishedRevision, action));
      expect(accepted.status, await accepted.clone().text()).toBe(200);
      expect(sessionParticipationResponseSchema.parse(await accepted.json()).status).toBe(
        policy === "approval" ? "approval_pending" : "reserved",
      );
    },
  );
  it("keeps the approved revision usable when only an organizer draft changes", async () => {
    const f = await fixture();
    await env.DB.prepare("UPDATE event_agenda_state SET revision=1 WHERE event_id=?").bind(f.eventId).run();
    await env.DB.prepare("UPDATE event_agenda_occurrences SET title='Unapproved draft' WHERE id=?")
      .bind(f.firstId)
      .run();
    const row = (await f.displayed()).sessions.find((item) => item.id === f.firstId)!;
    expect(row.publishedRevision).toBe(0);
    expect(row.title).toBe(f.firstId);
    const response = await f.reserve(command(row.publishedRevision));
    expect(response.status, await response.clone().text()).toBe(200);
  });
  it("rechecks the actual allocation batch and preserves the old overlapping reservation and every dependent effect", async () => {
    const f = await fixture();
    const original = await f.reserve(command(0));
    expect(original.status, await original.clone().text()).toBe(200);
    let preparedAllocation = false,
      raced = false;
    let concurrent: Awaited<ReturnType<typeof effects>> | undefined;
    const db: DatabaseLike = {
      prepare(sql) {
        if (sql.includes("INSERT INTO agenda_session_participations")) preparedAllocation = true;
        return env.DB.prepare(sql);
      },
      async batch(statements) {
        if (preparedAllocation && !raced) {
          raced = true;
          await f.advance();
          concurrent = await effects();
        }
        return env.DB.batch(statements);
      },
    };
    const response = await f.reserve({ ...command(0), replaceOccurrenceId: f.firstId }, f.secondId, { ...env, DB: db });
    expect(raced).toBe(true);
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "SESSION_PUBLICATION_CHANGED", details: null },
    });
    expect(await effects()).toEqual(concurrent);
    expect(
      await queryAll(
        env.DB,
        "SELECT occurrence_id,status FROM agenda_session_participations WHERE user_id=?",
        f.userId,
      ),
    ).toEqual([{ occurrence_id: f.firstId, status: "reserved" }]);
  });
  it.each(["save", "unsave", "cancel"] as const)("allows %s without a displayed-revision assertion", async (action) => {
    const f = await fixture();
    expect((await f.reserve(command(0))).status).toBe(200);
    await f.advance();
    const response = await f.reserve({ action, attendanceMode: "physical" });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(sessionParticipationResponseSchema.parse(await response.json()).status).toBe(
      action === "cancel" ? "canceled" : "reserved",
    );
  });
  it.each(["reserve", "request"] as const)("rejects a missing displayed revision on ordinary %s", async (action) => {
    const f = await fixture(action === "request" ? "approval" : "reservation"),
      before = await effects();
    const response = await f.reserve({ action, attendanceMode: "physical" });
    expect(response.status).toBe(400);
    expect(await effects()).toEqual(before);
  });
  it("keeps event ownership and live session authority separate from a valid revision", async () => {
    const f = await fixture(),
      before = await effects();
    const foreign = await f.reserve(command(0), crypto.randomUUID());
    expect(foreign.status).toBe(404);
    const revoked = await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?")
      .bind(nowIso(), f.userId)
      .run();
    expect(revoked.meta?.changes).toBe(1);
    const denied = await f.reserve(command(0));
    expect(denied.status).toBe(401);
    expect(await effects()).toEqual(before);
  });
});
