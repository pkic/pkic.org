import { env } from "cloudflare:workers";
import { eventVisibilitySchema } from "../assets/shared/schemas/event-series";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  agendaOccurrenceCreateSchema,
  agendaSnapshotSchema,
  type AgendaSnapshot,
} from "../assets/shared/schemas/event-agenda";
import { createAgendaOccurrence } from "../functions/_lib/services/event-agenda/mutations";
import type { Env } from "../functions/_lib/types";
import {
  publicAgendaCalendarPages,
  publicConferenceAgendaCalendar,
} from "../functions/_lib/services/site-agenda-calendar-pages";
import { publishedConferenceProgram } from "../functions/_lib/services/site-conference-program";
import { sitePublicationSnapshotSchema } from "../assets/shared/schemas/site-publication";
import { readPublicAgendaCalendars } from "../functions/_lib/services/site-publication-agenda-calendars";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";

const publicVisibility = eventVisibilitySchema.parse("public");
const privateVisibility = eventVisibilitySchema.parse("invitation_only");
const now = "2026-12-04T00:00:00.000Z";
async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  await env.DB.prepare("UPDATE events SET visibility=?,profile_key='conference' WHERE id=?")
    .bind(publicVisibility, eventId)
    .run();
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
  const token = await createAdminSession(env.DB, admin!.id, "public-calendar");
  const snapshot = await createAgendaOccurrence(
    env.DB,
    eventId,
    "pqc-2026",
    agendaOccurrenceCreateSchema.parse({
      expectedRevision: 0,
      title: "Synthetic public session",
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T10:00:00.000Z",
      roomId: null,
    }),
  );
  return { eventId, adminId: admin!.id, token, snapshot };
}
async function storedApproval(
  eventId: string,
  userId: string,
  source: AgendaSnapshot,
  revision: number,
  changes?: (snapshot: AgendaSnapshot) => void,
) {
  const snapshot = structuredClone(source);
  snapshot.revision = snapshot.publishedRevision = revision;
  snapshot.approvedAt = new Date(Date.parse("2026-10-01T00:00:00.000Z") + revision * 86400000).toISOString();
  snapshot.calendarPublic = true;
  changes?.(snapshot);
  await env.DB.prepare(
    "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,?,?,?,?)",
  )
    .bind(crypto.randomUUID(), eventId, revision, JSON.stringify(snapshot), userId, snapshot.approvedAt)
    .run();
  return snapshot;
}
describe("native build public calendar history", () => {
  beforeEach(resetDb);
  it("captures public event eligibility through the mounted approval route and ignores an input marker", async () => {
    const fixtureValue = await fixture();
    const response = await callApi(env, "/api/v1/events/pqc-2026/agenda/publications", {
      method: "POST",
      headers: { authorization: `Bearer ${fixtureValue.token}`, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: fixtureValue.snapshot.revision, calendarPublic: false }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    agendaSnapshotSchema.parse(await response.json());
    const [row] = await queryAll<{ snapshot_json: string }>(
      env.DB,
      "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=?",
      [fixtureValue.eventId],
    );
    expect(agendaSnapshotSchema.parse(JSON.parse(row!.snapshot_json)).calendarPublic).toBe(true);
    const exported = await readPublicAgendaCalendars(env.DB, now);
    expect(exported["pqc-2026"]!.entries[0]).toMatchObject({ sequence: 0, status: "confirmed" });
  });
  it("refuses a visibility race atomically without approval, revision, audit, notification or publication side effects", async () => {
    const fixtureValue = await fixture();
    const effects = () =>
      Promise.all(
        [
          "SELECT revision,published_revision FROM event_agenda_state",
          "SELECT id,snapshot_json FROM event_agenda_publications",
          "SELECT id,action,details_json FROM audit_log",
          "SELECT id,resource_id,revision FROM site_publication_requests",
          "SELECT id,payload_json FROM email_outbox",
        ].map((sql) => queryAll(env.DB, sql)),
      );
    const before = await effects();
    const raced = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("SELECT 1 FROM events WHERE id=? AND visibility=?"),
      () =>
        env.DB.prepare("UPDATE events SET visibility=? WHERE id=?").bind(privateVisibility, fixtureValue.eventId).run(),
    );
    const response = await callApi({ ...env, DB: raced } as Env, "/api/v1/events/pqc-2026/agenda/publications", {
      method: "POST",
      headers: { authorization: `Bearer ${fixtureValue.token}`, "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: fixtureValue.snapshot.revision }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "AGENDA_AUTHORIZATION_CHANGED" } });
    expect(
      await env.DB.prepare("SELECT visibility FROM events WHERE id=?").bind(fixtureValue.eventId).first("visibility"),
    ).toBe(privateVisibility);
    expect(await effects()).toEqual(before);
  });
  it("reads all101 approvals through bounded cursor pages and reconstructs the same unchanged sequence", async () => {
    const fixtureValue = await fixture();
    for (let revision = 1; revision <= 101; revision++)
      await storedApproval(fixtureValue.eventId, fixtureValue.adminId, fixtureValue.snapshot, revision);
    await env.DB.prepare("UPDATE event_agenda_state SET revision=101,published_revision=101 WHERE event_id=?")
      .bind(fixtureValue.eventId)
      .run();
    const prepare = vi.spyOn(env.DB, "prepare");
    try {
      const exported = await readPublicAgendaCalendars(env.DB, "2027-03-01T00:00:00.000Z");
      expect(exported["pqc-2026"]!.entries[0]).toMatchObject({ sequence: 0, updatedAt: "2026-10-02T00:00:00.000Z" });
      const historyQueries = prepare.mock.calls
        .map(([sql]) => sql)
        .filter((sql) => sql.includes("JOIN event_agenda_publications p"));
      expect(historyQueries).toHaveLength(3);
      expect(historyQueries.every((sql) => sql.includes("ORDER BY e.id,p.revision LIMIT 100"))).toBe(true);
    } finally {
      prepare.mockRestore();
    }
  });
  it("retains minimal withdrawal at the real authorized visibility audit time across a later private name edit", async () => {
    const fixtureValue = await fixture();
    const approval = await storedApproval(fixtureValue.eventId, fixtureValue.adminId, fixtureValue.snapshot, 2);
    await env.DB.prepare("UPDATE event_agenda_state SET revision=2,published_revision=2 WHERE event_id=?")
      .bind(fixtureValue.eventId)
      .run();
    const request = async (body: Record<string, unknown>) => {
      const [current] = await queryAll<{ updated_at: string }>(env.DB, "SELECT updated_at FROM events WHERE id=?", [
        fixtureValue.eventId,
      ]);
      return callApi(env, "/api/v1/events/pqc-2026/settings", {
        method: "PATCH",
        headers: { authorization: `Bearer ${fixtureValue.token}`, "content-type": "application/json" },
        body: JSON.stringify({ ...body, expectedUpdatedAt: current!.updated_at }),
      });
    };
    const withdrawn = await request({ visibility: privateVisibility });
    expect(withdrawn.status, await withdrawn.clone().text()).toBe(200);
    const [audit] = await queryAll<{ created_at: string }>(
      env.DB,
      "SELECT created_at FROM audit_log WHERE entity_id=? AND action='event_settings_updated' AND json_extract(details_json,'$.visibility.to')=?",
      [fixtureValue.eventId, privateVisibility],
    );
    expect(audit).toBeDefined();
    const renamed = await request({ name: "Synthetic private event label" });
    expect(renamed.status, await renamed.clone().text()).toBe(200);
    const exported = await readPublicAgendaCalendars(env.DB, new Date().toISOString());
    const retained = exported["pqc-2026"]!;
    expect(retained.name).toBe("Event calendar");
    expect(retained.entries).toEqual([
      {
        occurrenceId: approval.occurrences[0]!.id,
        sequence: 1,
        status: "canceled",
        updatedAt: audit!.created_at,
        startAt: approval.occurrences[0]!.startAt,
        endAt: approval.occurrences[0]!.endAt,
      },
    ]);
    expect(JSON.stringify(retained)).not.toContain("Synthetic private event label");
    expect(JSON.stringify(retained)).not.toContain("Synthetic public session");
    const expired = await readPublicAgendaCalendars(
      env.DB,
      new Date(Date.parse(audit!.created_at) + 91 * 86400000).toISOString(),
    );
    expect(expired["pqc-2026"]!.entries).toEqual([]);
    expect(expired["pqc-2026"]!.name).toBe("Event calendar");
    const publication = sitePublicationSnapshotSchema.parse({
      version: 1,
      snapshotId: "a".repeat(64),
      votes: [],
      publicResources: {},
      members: [],
      groups: {},
      groupMembers: {},
      sponsors: {},
      memberWall: [],
      news: [],
      sponsorNews: [],
      eventAgendaCalendars: expired,
    });
    const canonical = publicAgendaCalendarPages(publication)[0]!;
    expect(canonical.path).toBe(`${expired["pqc-2026"]!.agendaPath}calendar.ics`);
    const former = {
      route: "/events/pqc-2026/",
      updatedAt: approval.approvedAt!,
      program: publishedConferenceProgram(
        {
          name: "Withdrawn legacy label",
          timezone: approval.timeZone,
          agenda: {
            "2026-12-01": [{ time: "10:00", duration: 60, sessions: [{ title: "Withdrawn legacy session" }] }],
          },
        },
        () => [],
      ),
    };
    for (const content of [canonical.content, publicConferenceAgendaCalendar(publication, former)]) {
      expect(content).not.toContain("BEGIN:VEVENT");
      expect(content).not.toMatch(/Withdrawn legacy|Synthetic public session|Synthetic private event label/);
    }
  });
  it("accepts an ordinary own-key slug named constructor", async () => {
    const value = await fixture();
    await env.DB.prepare("UPDATE events SET slug='constructor',base_path=NULL WHERE id=?").bind(value.eventId).run();
    value.snapshot.eventSlug = "constructor";
    value.snapshot.publicAgendaPath = "/events/constructor/agenda/";
    await storedApproval(value.eventId, value.adminId, value.snapshot, 2);
    await env.DB.prepare("UPDATE event_agenda_state SET revision=2,published_revision=2 WHERE event_id=?")
      .bind(value.eventId)
      .run();
    const result = await readPublicAgendaCalendars(env.DB, now);
    expect(Object.hasOwn(result, "constructor")).toBe(true);
    expect(result["constructor"]!.agendaPath).toBe("/events/constructor/agenda/");
  });
  it("suppresses a proven former-public route with missing or ambiguous withdrawal proof without inventing cancellation", async () => {
    const fixtureValue = await fixture();
    await storedApproval(fixtureValue.eventId, fixtureValue.adminId, fixtureValue.snapshot, 2);
    await env.DB.prepare("UPDATE event_agenda_state SET revision=2,published_revision=2 WHERE event_id=?")
      .bind(fixtureValue.eventId)
      .run();
    await env.DB.prepare("UPDATE events SET visibility=?,updated_at=? WHERE id=?")
      .bind(privateVisibility, now, fixtureValue.eventId)
      .run();
    const missing = await readPublicAgendaCalendars(env.DB, now);
    expect(missing["pqc-2026"]!.entries).toEqual([]);
    expect(missing["pqc-2026"]!.name).toBe("Event calendar");
    expect(JSON.stringify(missing)).not.toContain("Synthetic public session");
    for (const visibility of [publicVisibility, privateVisibility])
      await env.DB.prepare(
        "INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,'user',?,'event_settings_updated','event',?,?,?)",
      )
        .bind(
          crypto.randomUUID(),
          fixtureValue.adminId,
          fixtureValue.eventId,
          JSON.stringify({ visibility: { to: visibility } }),
          "2026-10-04T00:00:00.000Z",
        )
        .run();
    const ambiguous = await readPublicAgendaCalendars(env.DB, now);
    expect(ambiguous).toEqual(missing);
    expect(JSON.stringify(ambiguous)).not.toMatch(/Synthetic public session|canceled/);
  });
});
