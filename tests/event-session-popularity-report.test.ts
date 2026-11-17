import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { sessionPopularityReportResponseSchema } from "../assets/shared/schemas/event-session-popularity-report";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const at = "2026-12-01T12:00:00.000Z";
let eventId: string, adminId: string, token: string;
let keynote: string, panel: string, workshop: string, silent: string, elsewhere: string;

function request(query = "", authorization: string | null = token) {
  return callApi(
    env,
    `/api/v1/events/pqc-2026/agenda/reports/popularity${query}`,
    { headers: authorization ? { authorization: `Bearer ${authorization}` } : {} },
    { maxRoundTrips: 1 },
  );
}

async function report(query = "") {
  const response = await request(query);
  expect(response.status, await response.clone().text()).toBe(200);
  return sessionPopularityReportResponseSchema.parse(await response.json());
}

const ids = (result: Awaited<ReturnType<typeof report>>) => result.sessions.map((row) => row.occurrenceId);

function reactions(owner: string, occurrenceId: string, values: Record<string, number>) {
  return Object.entries(values).map(([reaction, total]) =>
    env.DB.prepare(
      "INSERT INTO event_session_reaction_totals(event_id,occurrence_id,reaction,total,copied_at) VALUES(?,?,?,?,?)",
    ).bind(owner, occurrenceId, reaction, total, at),
  );
}

function question(occurrenceId: string, votes: number) {
  return env.DB.prepare(
    `INSERT INTO event_session_questions(id,event_id,occurrence_id,author_user_id,anonymous,body,status,vote_count,asked_at,copied_at)
     VALUES(?,?,?,?,0,'A synthetic question','approved',?,?,?)`,
  ).bind(crypto.randomUUID(), eventId, occurrenceId, adminId, votes, at, at);
}

function poll(occurrenceId: string, respondents: number) {
  return env.DB.prepare(
    `INSERT INTO event_session_polls(id,event_id,occurrence_id,field_json,show_results,status,respondents,created_by,created_at,copied_at)
     VALUES(?,?,?,'{}',1,'closed',?,?,?,?)`,
  ).bind(crypto.randomUUID(), eventId, occurrenceId, respondents, adminId, at, at);
}

describe("Session popularity report", () => {
  beforeEach(async () => {
    await resetDb();
    const fixture = await seedEventAndAdmin(env.DB);
    eventId = fixture.eventId;
    adminId = fixture.admin.id;
    token = await createAdminSession(env.DB, adminId, crypto.randomUUID());
    [keynote, panel, workshop, silent, elsewhere] = [1, 2, 3, 4, 5].map(() => crypto.randomUUID());
    const otherEvent = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO events (id,slug,name,timezone,source_path,registration_mode,settings_json,created_at,updated_at)
         VALUES(?,'other-2026','Other event','UTC','content/events/other/_index.md','invite_or_open','{}',datetime('now'),datetime('now'))`,
      ).bind(otherEvent),
      ...[
        [keynote, eventId, "Keynote: the road ahead", "2026-12-01T09:00:00.000Z"],
        [panel, eventId, "Panel on agility", "2026-12-01T11:00:00.000Z"],
        [workshop, eventId, "Hands-on workshop", "2026-12-01T14:00:00.000Z"],
        [silent, eventId, "Silent session", "2026-12-01T16:00:00.000Z"],
        [elsewhere, otherEvent, "Elsewhere", "2026-12-01T09:00:00.000Z"],
      ].map(([id, owner, title, startAt]) =>
        env.DB.prepare(
          "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at) VALUES(?,?,?,?,?)",
        ).bind(id, owner, title, startAt, "2026-12-01T18:00:00.000Z"),
      ),
      ...reactions(eventId, keynote, { applause: 40, love: 5, thumbs_up: 10, retired_reaction: 99 }),
      ...reactions(eventId, panel, { applause: 12, laugh: 30, mind_blown: 2 }),
      ...reactions(eventId, silent, { applause: 0 }),
      ...reactions(otherEvent, elsewhere, { applause: 500 }),
      question(panel, 7),
      question(panel, 3),
      question(workshop, 1),
      poll(workshop, 25),
      poll(workshop, 5),
    ]);
  });

  it("combines reactions, questions and poll answers per session in one round trip", async () => {
    const result = await report();
    expect(result.timeZone).toBe("Europe/Amsterdam");
    expect(result.page).toEqual({ limit: 50, offset: 0, total: 3, hasMore: false });
    expect(ids(result)).toEqual([keynote, panel, workshop]);
    expect(result.sessions[0]).toEqual({
      occurrenceId: keynote,
      title: "Keynote: the road ahead",
      startAt: "2026-12-01T09:00:00.000Z",
      reactions: [
        { reaction: "applause", total: 40 },
        { reaction: "love", total: 5 },
        { reaction: "laugh", total: 0 },
        { reaction: "mind_blown", total: 0 },
        { reaction: "thumbs_up", total: 10 },
      ],
      reactionTotal: 55,
      questions: 0,
      questionVotes: 0,
      pollAnswers: 0,
    });
    expect(result.sessions[1]).toMatchObject({ reactionTotal: 44, questions: 2, questionVotes: 10, pollAnswers: 0 });
    expect(result.sessions[2]).toMatchObject({ reactionTotal: 0, questions: 1, questionVotes: 1, pollAnswers: 30 });
  });

  it("sorts by any measure, searches titles, and pages on the server", async () => {
    // Ties fall back to the session id, so only the leaders are fixed here.
    expect(ids(await report("?sort=-laugh"))[0]).toBe(panel);
    expect(ids(await report("?sort=-questions"))).toEqual([panel, workshop, keynote]);
    expect(ids(await report("?sort=-pollAnswers"))[0]).toBe(workshop);
    expect(ids(await report("?sort=startAt"))).toEqual([keynote, panel, workshop]);
    expect(ids(await report("?q=agility"))).toEqual([panel]);
    const page = await report("?limit=1&offset=1");
    expect(ids(page)).toEqual([panel]);
    expect(page.page).toMatchObject({ total: 3, hasMore: true });
    expect((await request("?sort=-unknown")).status).toBe(400);
  });

  it("requires agenda reading permission", async () => {
    expect((await request("", null)).status).toBe(401);
    const outsider = await insertUser(env.DB);
    expect((await request("", await createAdminSession(env.DB, outsider, crypto.randomUUID()))).status).toBe(403);
  });
});
