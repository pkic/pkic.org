import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaOccurrenceListSchema,
  agendaOccurrenceQuerySchema,
  agendaSnapshotSchema,
  agendaImportSchema,
  agendaImportResponseSchema,
} from "../assets/shared/schemas/event-agenda";
import {
  agendaContentSchema,
  agendaContentPlacementResponseSchema,
} from "../assets/shared/schemas/event-agenda-content";
import { listFilterOptionsResponseSchema } from "../assets/shared/schemas/list-filter-options";
import { userAuthSessionResponseSchema } from "../assets/shared/schemas/user-auth";
import { agendaTransferSchema, transferPrepareSchema } from "../assets/shared/schemas/event-agenda-transfer";
import { normalizeAgendaTransfer } from "../assets/shared/event-agenda-transfer";
import { agendaContent } from "../assets/shared/public-agenda-content";
import { exportAgendaTransfer } from "../functions/_lib/services/event-agenda/transfer-export";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";

let eventId: string, actorId: string, token: string;
const root = "/api/v1/events/pqc-2026/agenda";
async function request(path: string, method = "GET", body?: unknown, credential = token) {
  return callApi(env, `${root}${path}`, {
    method,
    headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function revision() {
  return (await getAgenda(env.DB, eventId, "pqc-2026")).revision;
}
async function create(fields: Record<string, unknown> = {}) {
  const body = agendaOccurrenceCreateSchema.parse({
    expectedRevision: await revision(),
    title: "Track workshop",
    description: "A substantive program abstract about certificate governance and cryptographic migration.",
    startAt: null,
    endAt: null,
    roomId: null,
    ...fields,
  });
  const response = await request("/occurrences", "POST", body);
  expect(response.status, await response.clone().text()).toBe(200);
  const saved = agendaSnapshotSchema.parse(await response.json());
  return saved.occurrences.find((row) => row.title === body.title)!;
}
async function effects() {
  return Promise.all([
    queryAll(env.DB, "SELECT id,track,title FROM event_agenda_occurrences ORDER BY id"),
    queryAll(
      env.DB,
      "SELECT event_id,revision,published_revision,updated_at FROM event_agenda_state ORDER BY event_id",
    ),
    queryAll(env.DB, "SELECT id,actor_id,action,details_json FROM audit_log ORDER BY id"),
    queryAll(env.DB, "SELECT id,resource_id,revision,reason_code,status FROM site_publication_requests ORDER BY id"),
  ]);
}

describe("authored session tracks", () => {
  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(env.DB));
    actorId = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>())!.id;
    token = await createAdminSession(env.DB, actorId, crypto.randomUUID());
  });

  it("keeps legacy omission and explicit clearing distinct without inventing a fixed track vocabulary", () => {
    expect(agendaOccurrencePatchSchema.parse({ expectedRevision: 1, title: "Corrected" })).toEqual({
      expectedRevision: 1,
      title: "Corrected",
    });
    expect(agendaOccurrencePatchSchema.parse({ expectedRevision: 1, track: null }).track).toBeNull();
    expect(agendaOccurrencePatchSchema.parse({ expectedRevision: 1, track: "  Governance  " }).track).toBe(
      "Governance",
    );
    expect(agendaOccurrenceQuerySchema.parse({ track: "Custom program group" }).track).toBe("Custom program group");
    for (const track of ["", "   ", "x".repeat(161)])
      expect(agendaOccurrencePatchSchema.safeParse({ expectedRevision: 1, track }).success).toBe(false);
  });

  it("preserves omitted tracks, honors null, and rolls back stale edits through mounted occurrence routes", async () => {
    const occurrence = await create({ track: "Governance", kind: "plenary" });
    expect(occurrence).toMatchObject({ track: "Governance", kind: "plenary", roomId: null });
    const path = `/occurrences/${occurrence.id}`;
    const edited = await request(path, "PATCH", { expectedRevision: 1, title: "Retitled" });
    expect(edited.status).toBe(200);
    expect(agendaSnapshotSchema.parse(await edited.json()).occurrences[0]!.track).toBe("Governance");
    const before = await effects();
    expect((await request(path, "PATCH", { expectedRevision: 1, track: "Lost update" })).status).toBe(409);
    expect((await request(path, "PATCH", { expectedRevision: 2, track: "   " })).status).toBe(400);
    expect(await effects()).toEqual(before);
    const cleared = await request(path, "PATCH", { expectedRevision: 2, track: null });
    expect(cleared.status).toBe(200);
    expect(agendaSnapshotSchema.parse(await cleared.json()).occurrences[0]!.track).toBeNull();
    expect((await create({ title: "No authored track" })).track).toBeNull();
  });

  it("inherits content tracks into repeats and independent copies while retaining ordinary local snapshot semantics", async () => {
    const fields = { title: "Reusable content", kind: "session", track: "PKI", speakerUserIds: [] };
    const created = await request("/contents", "POST", { expectedRevision: 0, content: fields });
    expect(created.status).toBe(200);
    const content = agendaContentSchema.parse(await created.json());
    const place = async (copyAsNew = false) => {
      const response = await request(`/contents/${content.id}/placements`, "POST", {
        expectedRevision: await revision(),
        copyAsNew,
      });
      expect(response.status).toBe(200);
      return agendaContentPlacementResponseSchema.parse(await response.json());
    };
    const first = await place(),
      second = await place(),
      copied = await place(true);
    expect(new Set([first.occurrenceId, second.occurrenceId, copied.occurrenceId]).size).toBe(3);
    expect(copied.contentId).not.toBe(content.id);
    expect(
      copied.agenda.occurrences.every(
        (row) => row.track === "PKI" && row.startAt === null && row.visibility === "private",
      ),
    ).toBe(true);
    const local = await request(`/occurrences/${first.occurrenceId}`, "PATCH", {
      expectedRevision: await revision(),
      track: "Local grouping",
    });
    expect(local.status).toBe(200);
    expect(
      await env.DB.prepare("SELECT track FROM event_agenda_contents WHERE id=?").bind(content.id).first("track"),
    ).toBe("PKI");
    const omitted = { title: fields.title, kind: fields.kind, speakerUserIds: fields.speakerUserIds };
    const updated = await request(`/contents/${content.id}`, "PATCH", {
      expectedRevision: await revision(),
      content: { ...omitted, title: "Revised content" },
    });
    expect(updated.status).toBe(200);
    expect(agendaContentSchema.parse(await updated.json()).track).toBe("PKI");
    const clear = await request(`/contents/${content.id}`, "PATCH", {
      expectedRevision: await revision(),
      content: { ...fields, track: null },
    });
    expect(clear.status).toBe(200);
    const agenda = await getAgenda(env.DB, eventId, "pqc-2026");
    expect(agenda.occurrences.filter((row) => row.contentId === content.id).every((row) => row.track === null)).toBe(
      true,
    );
    expect(agenda.occurrences.find((row) => row.id === copied.occurrenceId)!.track).toBe("PKI");
  });

  it("filters before counting/pagination and pages distinct event-owned track options independently of loaded rows", async () => {
    await env.DB.batch(
      Array.from({ length: 53 }, (_, index) =>
        env.DB.prepare(
          "INSERT INTO event_agenda_occurrences(id,event_id,title,track,kind) VALUES(?,?,?,?,'session')",
        ).bind(crypto.randomUUID(), eventId, `Session ${index}`, `Track ${String(index).padStart(2, "0")}`),
      ),
    );
    await create({ title: "Same track other type", track: "Track 00", kind: "break" });
    await create({ title: "Untracked item" });
    const foreign = crypto.randomUUID(),
      now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,?,'Foreign','UTC','{}',?,?)",
    )
      .bind(foreign, foreign, now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,track) VALUES(?,?,'Private foreign','Foreign secret track')",
    )
      .bind(crypto.randomUUID(), foreign)
      .run();
    const options = async (offset: number) => {
      const response = await request(`/occurrences/filters?field=track&limit=50&offset=${offset}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      return listFilterOptionsResponseSchema.parse(await response.json());
    };
    const first = await options(0),
      last = await options(50);
    expect(first.options).toHaveLength(50);
    expect(last.options).toHaveLength(3);
    expect(first.page.total).toBe(53);
    expect([...first.options, ...last.options].map((option) => option.value)).toEqual(
      Array.from({ length: 53 }, (_, index) => `Track ${String(index).padStart(2, "0")}`),
    );
    const rows = await request("/occurrences?track=Track%2000&limit=1&sort=title");
    expect(rows.status).toBe(200);
    const page = agendaOccurrenceListSchema.parse(await rows.json());
    expect(page.page).toMatchObject({ total: 2, hasMore: true });
    expect(page.occurrences).toHaveLength(1);
    expect(page.occurrences[0]!.track).toBe("Track 00");
    const search = await request("/occurrences/filters?field=track&q=Track%2052");
    expect(listFilterOptionsResponseSchema.parse(await search.json()).options).toEqual([
      { value: "Track 52", label: "Track 52" },
    ]);
    const unknown = await request("/occurrences?track=Foreign%20secret%20track");
    expect(agendaOccurrenceListSchema.parse(await unknown.json()).page.total).toBe(0);
    expect((await callApi(env, `${root}/occurrences/filters?field=track`)).status).toBe(401);
    const ordinary = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
      .bind(ordinary, `${ordinary}@example.test`, `${ordinary}@example.test`)
      .run();
    // A foreign-event grant establishes a real staff session without authority over this event.
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:read','event',?,?)",
    )
      .bind(crypto.randomUUID(), ordinary, foreign, now)
      .run();
    const unassigned = await createAdminSession(env.DB, ordinary, crypto.randomUUID());
    const authenticated = await callApi(env, "/api/v1/auth/session", {
      headers: { authorization: `Bearer ${unassigned}` },
    });
    expect(authenticated.status, await authenticated.clone().text()).toBe(200);
    expect(userAuthSessionResponseSchema.parse(await authenticated.json()).identity.id).toBe(ordinary);
    expect((await request("/occurrences/filters?field=track", "GET", undefined, unassigned)).status).toBe(403);
    expect((await request("/occurrences?track=Track%2000", "GET", undefined, unassigned)).status).toBe(403);
  });

  it("retains approved track metadata in immutable publication and marks later draft track edits changed", async () => {
    const occurrence = await create({
      track: "Algorithms",
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T10:00:00.000Z",
    });
    const published = await request("/publications", "POST", { expectedRevision: 1 });
    expect(published.status, await published.clone().text()).toBe(200);
    const original = await env.DB.prepare("SELECT snapshot_json FROM event_agenda_publications WHERE event_id=?")
      .bind(eventId)
      .first<string>("snapshot_json");
    const snapshot = agendaSnapshotSchema.parse(JSON.parse(original!));
    expect(snapshot.occurrences[0]!.track).toBe("Algorithms");
    expect(agendaContent(snapshot).days[0]!.slots[0]!.sessions[0]!.track).toBe("Algorithms");
    const changed = await request(`/occurrences/${occurrence.id}`, "PATCH", {
      expectedRevision: 2,
      track: "Governance",
    });
    expect(changed.status).toBe(200);
    expect(agendaSnapshotSchema.parse(await changed.json()).occurrences[0]).toMatchObject({
      track: "Governance",
      publicationStatus: "changed",
    });
    expect(
      await env.DB.prepare("SELECT snapshot_json FROM event_agenda_publications WHERE event_id=?")
        .bind(eventId)
        .first("snapshot_json"),
    ).toBe(original);
    const restored = await request(`/occurrences/${occurrence.id}`, "PATCH", {
      expectedRevision: 3,
      track: "Algorithms",
    });
    expect(restored.status).toBe(200);
    expect(agendaSnapshotSchema.parse(await restored.json()).occurrences[0]!.publicationStatus).toBe("published");
  });

  it("preserves authored tracks in portable and fresh-copy fields and accepts old documents without them", async () => {
    await create({ track: "Custom authored group" });
    const document = await exportAgendaTransfer(env.DB, eventId, "pqc-2026", agendaOccurrenceQuerySchema.parse({}));
    expect(document.occurrences[0]!.fields.track).toBe("Custom authored group");
    const prepared = transferPrepareSchema.parse({
      expectedRevision: await revision(),
      mode: "copy_as_new",
      document,
      resolutions: { people: {}, rooms: {}, media: {}, rows: {} },
    });
    const normalized = normalizeAgendaTransfer(prepared);
    expect(normalized.findings.some((finding) => finding.severity === "blocking")).toBe(false);
    expect(normalized.occurrences[0]).toMatchObject({
      track: "Custom authored group",
      startAt: null,
      endAt: null,
      roomId: null,
      visibility: "private",
    });
    delete document.occurrences[0]!.fields.track;
    expect(agendaTransferSchema.parse(document).occurrences[0]!.fields.track).toBeUndefined();
  });

  it("treats old omitted tracks as unchanged source metadata and reviews new authored tracks before applying them", async () => {
    const fields = {
      sourceKey: "legacy:track-source",
      title: "Legacy source",
      startAt: null,
      endAt: null,
      roomId: null,
    };
    const apply = async (track?: string) => {
      const input = agendaImportSchema.parse({
        source: "legacy",
        dryRun: false,
        expectedRevision: await revision(),
        occurrences: [{ ...fields, ...(track === undefined ? {} : { track }) }],
      });
      const response = await request("/imports", "POST", input);
      expect(response.status, await response.clone().text()).toBe(200);
      return agendaImportResponseSchema.parse(await response.json());
    };
    const initial = await apply();
    expect(initial.imported).toBe(1);
    expect(initial.agenda.occurrences[0]!.track).toBeNull();
    const replay = await apply();
    expect(replay).toMatchObject({ imported: 0, reviewRequired: 0 });
    expect(replay.agenda.revision).toBe(initial.agenda.revision);
    const changed = await apply("Industry");
    expect(changed).toMatchObject({ imported: 0, reviewRequired: 1 });
    expect(changed.agenda.occurrences[0]!.track).toBeNull();
    const contentId = changed.agenda.occurrences[0]!.contentId!;
    const contentRow = await env.DB.prepare("SELECT source_review_json FROM event_agenda_contents WHERE id=?")
      .bind(contentId)
      .first<string>("source_review_json");
    const review = agendaContentSchema.shape.review.parse(JSON.parse(contentRow!));
    expect(review!.incoming!.track).toBe("Industry");
    const accepted = await request(`/contents/${contentId}`, "PATCH", {
      expectedRevision: await revision(),
      resolveSourceReview: true,
      content: review!.incoming,
    });
    expect(accepted.status).toBe(200);
    expect(agendaContentSchema.parse(await accepted.json()).track).toBe("Industry");
    expect((await getAgenda(env.DB, eventId, "pqc-2026")).occurrences[0]!.track).toBe("Industry");
  });
});
