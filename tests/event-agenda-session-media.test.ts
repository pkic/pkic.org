import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaRevisionSchema,
  agendaSnapshotSchema,
} from "../assets/shared/schemas/event-agenda";
import { sessionVirtualRoomResponseSchema } from "../assets/shared/schemas/event-session-virtual-room";
import { publicAgendaProjection } from "../functions/_lib/services/event-agenda/public-projection";
import type { DatabaseLike } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { resetDb } from "./helpers/reset-db";

const base = "/api/v1/events/pqc-2026/agenda";
const originalSettings = {
  location: { venue: "Existing venue" },
  virtualUrl: "https://example.test/event",
  agenda: {
    durationRules: { defaultDurationMinutes: 30 },
    sessionMedia: { unrelated: { joinUrl: "https://example.test/other", captions: true } },
  },
};
const joinUrl = "https://example.test/public-room?meeting=session";
beforeEach(resetDb);
async function fixture() {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  await env.DB.prepare("UPDATE events SET settings_json=? WHERE id=?")
    .bind(JSON.stringify(originalSettings), eventId)
    .run();
  const token = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const raw = (
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
    database: DatabaseLike = env.DB,
    auth = true,
  ) =>
    callApi({ ...env, DB: database }, path, {
      method,
      headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const createBody = (virtualRoomUrl?: string | null) =>
    agendaOccurrenceCreateSchema.parse({
      expectedRevision: 0,
      title: "Public virtual room session",
      description: "A substantive session about reliable certificate operations and cryptographic interoperability.",
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T10:00:00.000Z",
      roomId: null,
      ...(virtualRoomUrl === undefined ? {} : { virtualRoomUrl }),
    });
  async function create(virtualRoomUrl?: string | null) {
    const response = await raw(`${base}/occurrences`, createBody(virtualRoomUrl));
    expect(response.status, await response.clone().text()).toBe(200);
    return agendaSnapshotSchema.parse(await response.json());
  }
  async function settings() {
    const [event] = await queryAll<{ settings_json: string }>(
      env.DB,
      "SELECT settings_json FROM events WHERE id=?",
      eventId,
    );
    return JSON.parse(event!.settings_json);
  }
  return { eventId, adminId: admin.id, raw, create, createBody, settings };
}
async function effects() {
  return Promise.all(
    [
      "events",
      "event_agenda_occurrences",
      "event_agenda_occurrence_speakers",
      "event_agenda_occurrence_rooms",
      "event_agenda_state",
      "event_agenda_publications",
      "audit_log",
      "email_outbox",
      "site_publication_requests",
    ].map((table) => queryAll(env.DB, `SELECT * FROM ${table} ORDER BY rowid`)),
  );
}

describe("owned per-session virtual room URL in event settings", () => {
  it("creates and reads the canonical optional URL without overwriting other event or session settings", async () => {
    const f = await fixture(),
      created = await f.create(joinUrl),
      occurrence = created.occurrences[0]!;
    expect(occurrence.virtualRoomUrl).toBe(joinUrl);
    expect(await f.settings()).toEqual({
      ...originalSettings,
      agenda: {
        ...originalSettings.agenda,
        sessionMedia: { ...originalSettings.agenda.sessionMedia, [occurrence.id]: { joinUrl } },
      },
    });
    const response = await f.raw(`${base}/occurrences`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ occurrences: [{ id: occurrence.id, virtualRoomUrl: joinUrl }] });
  });

  it("keeps the URL on omitted edits, updates only its leaf, and clears only that leaf on explicit null", async () => {
    const f = await fixture(),
      created = await f.create(),
      id = created.occurrences[0]!.id;
    expect(created.occurrences[0]).not.toHaveProperty("virtualRoomUrl");
    await env.DB.prepare("UPDATE events SET settings_json=json_set(settings_json,?,1) WHERE id=?")
      .bind(`$.agenda.sessionMedia.${JSON.stringify(id)}.captions`, f.eventId)
      .run();
    let revision = created.revision;
    for (const patch of [
      { virtualRoomUrl: joinUrl },
      { title: "Corrected title" },
      { virtualRoomUrl: "https://example.test/replacement" },
      { virtualRoomUrl: null },
    ]) {
      const response = await f.raw(
        `${base}/occurrences/${id}`,
        agendaOccurrencePatchSchema.parse({ expectedRevision: revision, ...patch }),
        "PATCH",
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const saved = agendaSnapshotSchema.parse(await response.json());
      revision = saved.revision;
      if (patch.virtualRoomUrl === null) expect(saved.occurrences[0]).not.toHaveProperty("virtualRoomUrl");
      else expect(saved.occurrences[0]!.virtualRoomUrl).toBe(patch.virtualRoomUrl ?? joinUrl);
    }
    expect(await f.settings()).toEqual({
      ...originalSettings,
      agenda: {
        ...originalSettings.agenda,
        sessionMedia: { ...originalSettings.agenda.sessionMedia, [id]: { captions: 1 } },
      },
    });
  });

  it("captures the URL in the approved immutable snapshot while a later draft change stays separate", async () => {
    const f = await fixture(),
      created = await f.create(joinUrl),
      id = created.occurrences[0]!.id;
    const response = await f.raw(
      `${base}/publications`,
      agendaRevisionSchema.parse({ expectedRevision: created.revision }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const approved = agendaSnapshotSchema.parse(await response.json());
    const publications = await queryAll<{ snapshot_json: string }>(
      env.DB,
      "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=?",
      f.eventId,
    );
    expect(publications).toHaveLength(1);
    expect(agendaSnapshotSchema.parse(JSON.parse(publications[0]!.snapshot_json)).occurrences[0]!.virtualRoomUrl).toBe(
      joinUrl,
    );
    const edited = await f.raw(
      `${base}/occurrences/${id}`,
      { expectedRevision: approved.revision, virtualRoomUrl: "https://example.test/new-draft" },
      "PATCH",
    );
    expect(edited.status, await edited.clone().text()).toBe(200);
    expect(
      await queryAll(env.DB, "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=?", f.eventId),
    ).toEqual(publications);
  });

  it("rejects stale revisions, unauthenticated edits and unsafe URLs without any settings or agenda effects", async () => {
    const f = await fixture(),
      created = await f.create(joinUrl),
      id = created.occurrences[0]!.id;
    const before = await effects();
    const stale = await f.raw(`${base}/occurrences/${id}`, { expectedRevision: 0, virtualRoomUrl: null }, "PATCH");
    expect(stale.status).toBe(409);
    expect(await effects()).toEqual(before);
    const unauthorized = await f.raw(
      `${base}/occurrences/${id}`,
      { expectedRevision: created.revision, virtualRoomUrl: null },
      "PATCH",
      undefined,
      false,
    );
    expect(unauthorized.status).toBe(401);
    expect(await effects()).toEqual(before);
    const invalid = await f.raw(
      `${base}/occurrences/${id}`,
      { expectedRevision: created.revision, virtualRoomUrl: "javascript:alert(1)" },
      "PATCH",
    );
    expect(invalid.status).toBe(400);
    expect(await effects()).toEqual(before);
  });

  it("rolls back the entire occurrence edit if another writer changes event settings after preflight", async () => {
    const f = await fixture(),
      created = await f.create(joinUrl),
      id = created.occurrences[0]!.id;
    const before = await effects();
    let raced = false;
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.startsWith("UPDATE events SET settings_json=json_set"),
      async () => {
        raced = true;
        await env.DB.prepare(
          "UPDATE events SET settings_json=json_set(settings_json,'$.concurrentSetting',1) WHERE id=?",
        )
          .bind(f.eventId)
          .run();
      },
    );
    const response = await f.raw(
      `${base}/occurrences/${id}`,
      { expectedRevision: created.revision, title: "Lost edit", virtualRoomUrl: "https://example.test/lost" },
      "PATCH",
      db,
    );
    expect(raced).toBe(true);
    expect(response.status, await response.clone().text()).toBe(409);
    const after = await effects();
    expect(after.slice(1)).toEqual(before.slice(1));
    expect(await f.settings()).toMatchObject({ concurrentSetting: 1, agenda: { sessionMedia: { [id]: { joinUrl } } } });
  });

  it("rolls back a new occurrence and all dependent effects on a concurrent settings change", async () => {
    const f = await fixture(),
      before = await effects();
    let raced = false;
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.startsWith("UPDATE events SET settings_json=json_set"),
      async () => {
        raced = true;
        await env.DB.prepare(
          "UPDATE events SET settings_json=json_set(settings_json,'$.concurrentSetting',1) WHERE id=?",
        )
          .bind(f.eventId)
          .run();
      },
    );
    const response = await f.raw(`${base}/occurrences`, f.createBody(joinUrl), "POST", db);
    expect(raced).toBe(true);
    expect(response.status, await response.clone().text()).toBe(409);
    expect((await effects()).slice(1)).toEqual(before.slice(1));
    expect(await f.settings()).toEqual({ ...originalSettings, concurrentSetting: 1 });
  });
});

async function approvedVirtualRoom(
  admissionPolicy: "preference" | "reservation" = "preference",
  accessPolicy: "open" | "invitation" = "open",
) {
  const f = await fixture();
  let snapshot = await f.create(joinUrl);
  const id = snapshot.occurrences[0]!.id;
  if (admissionPolicy !== "preference" || accessPolicy !== "open") {
    const edited = await f.raw(
      `${base}/occurrences/${id}`,
      { expectedRevision: snapshot.revision, admissionPolicy, accessPolicy },
      "PATCH",
    );
    expect(edited.status).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await edited.json());
  }
  const published = await f.raw(`${base}/publications`, { expectedRevision: snapshot.revision });
  expect(published.status, await published.clone().text()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await published.json());
  const registrationId = crypto.randomUUID();
  async function register() {
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','virtual','test',?,datetime('now'),datetime('now'))",
    )
      .bind(registrationId, f.eventId, f.adminId, crypto.randomUUID())
      .run();
  }
  return { ...f, id, snapshot, registrationId, register, path: `${base}/occurrences/${id}/virtual-room` };
}

describe("join destinations stay private and require live actual attendee entitlement", () => {
  it("removes every raw URL from public projection even for open/public sessions while retaining only availability", async () => {
    const f = await approvedVirtualRoom();
    const [row] = await queryAll<{ snapshot_json: string }>(
      env.DB,
      "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=?",
      f.eventId,
    );
    const approved = agendaSnapshotSchema.parse(JSON.parse(row!.snapshot_json));
    const publicData = publicAgendaProjection(approved, null);
    expect(publicData.occurrences[0]!.onlineAccessAvailable).toBe(true);
    expect(JSON.stringify(publicData)).not.toContain(joinUrl);
    expect(JSON.stringify(publicData)).not.toContain("virtualRoomUrl");
    expect(approved.occurrences[0]!.virtualRoomUrl).toBe(joinUrl);
  });

  it("refuses anonymous and authenticated nonattendees including staff, then returns only a no-store attendee destination", async () => {
    const f = await approvedVirtualRoom();
    const anonymous = await f.raw(f.path, undefined, "GET", undefined, false);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.text()).not.toContain(joinUrl);
    const staffWithoutRegistration = await f.raw(f.path);
    expect(staffWithoutRegistration.status).toBe(403);
    expect(await staffWithoutRegistration.text()).not.toContain(joinUrl);
    await f.register();
    const before = await effects();
    const allowed = await f.raw(f.path);
    expect(allowed.status, await allowed.clone().text()).toBe(200);
    expect(allowed.headers.get("cache-control")).toContain("no-store");
    expect(sessionVirtualRoomResponseSchema.parse(await allowed.json())).toEqual({ url: joinUrl });
    expect(await effects()).toEqual(before);
    const personal = await f.raw(`${base}/participation`);
    expect(personal.status).toBe(200);
    const listing = await personal.json();
    expect(listing).toMatchObject({ sessions: [{ id: f.id, onlineAccessAvailable: true }] });
    expect(JSON.stringify(listing)).not.toContain(joinUrl);
    await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE id=?").bind(f.registrationId).run();
    const canceled = await f.raw(f.path);
    expect(canceled.status).toBe(403);
    expect(await canceled.text()).not.toContain(joinUrl);
  });

  it("requires actual session acceptance and an unrevoked invitation where the approved policies require them", async () => {
    const f = await approvedVirtualRoom("reservation", "invitation");
    await f.register();
    const participationId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at) VALUES(?,?,?,?,'remote','approval_pending',datetime('now'),datetime('now'))",
    )
      .bind(participationId, f.eventId, f.id, f.adminId)
      .run();
    await env.DB.prepare(
      "INSERT INTO agenda_session_invitations(id,event_id,occurrence_id,user_id,invited_by,reason_code,created_at) VALUES(?,?,?,?,?,'test',datetime('now'))",
    )
      .bind(crypto.randomUUID(), f.eventId, f.id, f.adminId, f.adminId)
      .run();
    for (const status of ["approval_pending", "waitlisted", "canceled"]) {
      await env.DB.prepare("UPDATE agenda_session_participations SET status=? WHERE id=?")
        .bind(status, participationId)
        .run();
      const refused = await f.raw(f.path);
      expect(refused.status).toBe(403);
      expect(await refused.text()).not.toContain(joinUrl);
    }
    await env.DB.prepare("UPDATE agenda_session_participations SET status='reserved' WHERE id=?")
      .bind(participationId)
      .run();
    expect((await f.raw(f.path)).status).toBe(200);
    await env.DB.prepare("UPDATE agenda_session_invitations SET revoked_at=datetime('now') WHERE occurrence_id=?")
      .bind(f.id)
      .run();
    expect((await f.raw(f.path)).status).toBe(403);
  });

  it("preserves an approved destination across unrelated draft edits but refuses changed or cleared destinations and marks freshness", async () => {
    const f = await approvedVirtualRoom();
    await f.register();
    const corrected = await f.raw(
      `${base}/occurrences/${f.id}`,
      { expectedRevision: f.snapshot.revision, title: "Unrelated title edit" },
      "PATCH",
    );
    expect(corrected.status).toBe(200);
    let snapshot = agendaSnapshotSchema.parse(await corrected.json());
    expect((await f.raw(f.path)).status).toBe(200);
    const changed = await f.raw(
      `${base}/occurrences/${f.id}`,
      { expectedRevision: snapshot.revision, virtualRoomUrl: "https://example.test/unapproved" },
      "PATCH",
    );
    expect(changed.status).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await changed.json());
    expect(snapshot.occurrences[0]!.publicationStatus).toBe("changed");
    const refused = await f.raw(f.path);
    expect(refused.status).toBe(403);
    expect(await refused.text()).not.toContain(joinUrl);
    const personal = await f.raw(`${base}/participation`);
    expect(await personal.json()).toMatchObject({ sessions: [{ onlineAccessAvailable: false }] });
    const cleared = await f.raw(
      `${base}/occurrences/${f.id}`,
      { expectedRevision: snapshot.revision, virtualRoomUrl: null },
      "PATCH",
    );
    expect(cleared.status).toBe(200);
    expect((await f.raw(f.path)).status).toBe(403);
  });

  it("compares URL freshness even when that leaf is the only edited field", async () => {
    const f = await approvedVirtualRoom();
    expect(f.snapshot.occurrences[0]!.publicationStatus).toBe("published");
    const changed = await f.raw(
      `${base}/occurrences/${f.id}`,
      { expectedRevision: f.snapshot.revision, virtualRoomUrl: "https://example.test/new-room" },
      "PATCH",
    );
    expect(changed.status).toBe(200);
    expect(agendaSnapshotSchema.parse(await changed.json()).occurrences[0]!.publicationStatus).toBe("changed");
  });

  it("rechecks live registration and exact caller session at the final destination read", async () => {
    const f = await approvedVirtualRoom();
    await f.register();
    for (const change of ["registration", "session"] as const) {
      if (change === "session")
        await env.DB.prepare("UPDATE registrations SET status='registered' WHERE id=?").bind(f.registrationId).run();
      let raced = false;
      const db = mutateBeforeMatchingQuery(
        env.DB,
        (sql) => sql.includes("SELECT COALESCE(json_extract(approved.payload_json,'$.virtualRoomUrl')"),
        async () => {
          raced = true;
          if (change === "registration")
            await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE id=?").bind(f.registrationId).run();
          else
            await env.DB.prepare("UPDATE sessions SET revoked_at=datetime('now') WHERE user_id=?")
              .bind(f.adminId)
              .run();
        },
      );
      const response = await f.raw(f.path, undefined, "GET", db);
      expect(raced).toBe(true);
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain(joinUrl);
    }
  });
});

describe("sessions follow their location's virtual room unless they override it", () => {
  const roomLink = "https://example.test/location-room";
  async function inheritedFixture() {
    const f = await fixture();
    const room = await f.raw(`${base}/rooms`, {
      expectedRevision: 0,
      name: "Streaming hall",
      capacity: 50,
      equipment: ["recording"],
      virtualRoomUrl: roomLink,
    });
    expect(room.status, await room.clone().text()).toBe(200);
    let snapshot = agendaSnapshotSchema.parse(await room.json());
    const roomId = snapshot.rooms[0]!.id;
    expect(snapshot.rooms[0]!.virtualRoomUrl).toBe(roomLink);
    const created = await f.raw(`${base}/occurrences`, {
      ...f.createBody(),
      expectedRevision: snapshot.revision,
      roomId,
    });
    expect(created.status, await created.clone().text()).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await created.json());
    const occurrence = snapshot.occurrences[0]!;
    expect(occurrence).not.toHaveProperty("virtualRoomUrl");
    expect(occurrence).not.toHaveProperty("plannedMedia");
    const published = await f.raw(`${base}/publications`, { expectedRevision: snapshot.revision });
    expect(published.status, await published.clone().text()).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await published.json());
    const registrationId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','virtual','test',?,datetime('now'),datetime('now'))",
    )
      .bind(registrationId, f.eventId, f.adminId, crypto.randomUUID())
      .run();
    return { ...f, roomId, snapshot, id: occurrence.id, path: `${base}/occurrences/${occurrence.id}/virtual-room` };
  }

  it("releases the inherited location link to entitled attendees and keeps it out of public data", async () => {
    const f = await inheritedFixture();
    const allowed = await f.raw(f.path);
    expect(allowed.status, await allowed.clone().text()).toBe(200);
    expect(sessionVirtualRoomResponseSchema.parse(await allowed.json())).toEqual({ url: roomLink });
    expect(await (await f.raw(`${base}/participation`)).json()).toMatchObject({
      sessions: [{ id: f.id, onlineAccessAvailable: true }],
    });
    const [row] = await queryAll<{ snapshot_json: string }>(
      env.DB,
      "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=?",
      f.eventId,
    );
    const publicData = publicAgendaProjection(agendaSnapshotSchema.parse(JSON.parse(row!.snapshot_json)), null);
    expect(publicData.occurrences[0]!.onlineAccessAvailable).toBe(true);
    expect(JSON.stringify(publicData)).not.toContain(roomLink);
  });

  it("revokes the approved link when the location link changes and marks the session changed", async () => {
    const f = await inheritedFixture();
    expect(f.snapshot.occurrences[0]!.publicationStatus).toBe("published");
    const moved = await f.raw(
      `${base}/rooms/${f.roomId}`,
      {
        expectedRevision: f.snapshot.revision,
        name: "Streaming hall",
        capacity: 50,
        equipment: ["recording"],
        virtualRoomUrl: "https://example.test/replacement-room",
      },
      "PUT",
    );
    expect(moved.status, await moved.clone().text()).toBe(200);
    expect(agendaSnapshotSchema.parse(await moved.json()).occurrences[0]!.publicationStatus).toBe("changed");
    const refused = await f.raw(f.path);
    expect(refused.status).toBe(403);
    expect(await refused.text()).not.toContain(roomLink);
  });

  it("stores an override as the session's own plan, which replaces the location link", async () => {
    const f = await inheritedFixture();
    const overridden = await f.raw(
      `${base}/occurrences/${f.id}`,
      { expectedRevision: f.snapshot.revision, plannedMedia: { recording: false, liveStreaming: false } },
      "PATCH",
    );
    expect(overridden.status, await overridden.clone().text()).toBe(200);
    const draft = agendaSnapshotSchema.parse(await overridden.json());
    expect(draft.occurrences[0]).toMatchObject({
      plannedMedia: { recording: false, liveStreaming: false },
      publicationStatus: "changed",
    });
    expect(await queryAll(env.DB, "SELECT planned_media_json FROM event_agenda_occurrences WHERE id=?", f.id)).toEqual([
      { planned_media_json: '{"recording":false,"liveStreaming":false}' },
    ]);
    expect((await f.raw(f.path)).status).toBe(403);
    const republished = await f.raw(`${base}/publications`, { expectedRevision: draft.revision });
    expect(republished.status, await republished.clone().text()).toBe(200);
    expect(agendaSnapshotSchema.parse(await republished.json()).occurrences[0]!.publicationStatus).toBe("published");
    expect((await f.raw(f.path)).status).toBe(403);
    const inheritedAgain = await f.raw(
      `${base}/occurrences/${f.id}`,
      { expectedRevision: draft.revision + 1, plannedMedia: null },
      "PATCH",
    );
    expect(inheritedAgain.status, await inheritedAgain.clone().text()).toBe(200);
    expect(agendaSnapshotSchema.parse(await inheritedAgain.json()).occurrences[0]).not.toHaveProperty("plannedMedia");
  });
});
