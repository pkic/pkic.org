import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaSnapshotSchema,
} from "../assets/shared/schemas/event-agenda";
import { createAgendaOccurrence } from "../functions/_lib/services/event-agenda/mutations";
import { publishedSessionRoute } from "../assets/shared/session-public-route";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";

const original = {
  title: "Existing session",
  description: "A substantive approved session abstract about certificate operations and cryptographic migration.",
  startAt: "2026-12-01T09:00:00.000Z",
  endAt: "2026-12-01T10:00:00.000Z",
  roomId: null,
  admissionPolicy: "approval",
  capacity: 7,
  remoteCapacity: 11,
  visibility: "private",
  kind: "plenary",
};

async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
  const token = await createAdminSession(env.DB, admin!.id, "occurrence-patch");
  const created = await createAgendaOccurrence(
    env.DB,
    eventId,
    "pqc-2026",
    agendaOccurrenceCreateSchema.parse({ expectedRevision: 0, ...original }),
  );
  const occurrenceId = created.occurrences[0]!.id;
  const request = (input: unknown) =>
    callApi(env, `/api/v1/events/pqc-2026/agenda/occurrences/${occurrenceId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  return { eventId, occurrenceId, request };
}

describe("occurrence PATCH omission semantics", () => {
  beforeEach(resetDb);

  it("parses a title-only PATCH without create defaults while retaining those defaults on creation", () => {
    expect(agendaOccurrencePatchSchema.parse({ expectedRevision: 1, title: "Corrected title" })).toEqual({
      expectedRevision: 1,
      title: "Corrected title",
    });
    expect(
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: 0,
        title: "New session",
        startAt: null,
        endAt: null,
        roomId: null,
      }),
    ).toMatchObject({
      description: "",
      admissionPolicy: "preference",
      capacity: null,
      remoteCapacity: null,
      visibility: "public",
      kind: "session",
    });
  });

  it("preserves all omitted non-default occurrence fields through a mounted title-only PATCH", async () => {
    const { request } = await fixture();
    const response = await request({ expectedRevision: 1, title: "Corrected title" });
    expect(response.status, await response.clone().text()).toBe(200);
    const saved = agendaSnapshotSchema.parse(await response.json());
    expect(saved.revision).toBe(2);
    expect(saved.occurrences[0]).toMatchObject({ ...original, title: "Corrected title" });
    const madePublic = await request({ expectedRevision: 2, visibility: "public" });
    expect(madePublic.status).toBe(200);
    const publicCopy = agendaSnapshotSchema.parse(await madePublic.json());
    expect(publicCopy.occurrences[0]!.description).toBe(original.description);
    expect(publishedSessionRoute("pqc-2026", publicCopy.occurrences[0]!)).toBe(
      `/events/pqc-2026/sessions/${publicCopy.occurrences[0]!.id}/`,
    );
  });

  it("honors explicit clears and policy changes while a stale PATCH leaves every stored effect unchanged", async () => {
    const { request } = await fixture();
    const response = await request({
      expectedRevision: 1,
      description: "",
      admissionPolicy: "preference",
      capacity: null,
      remoteCapacity: null,
      visibility: "public",
      kind: "session",
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const saved = agendaSnapshotSchema.parse(await response.json());
    expect(saved.occurrences[0]).toMatchObject({
      title: original.title,
      description: "",
      admissionPolicy: "preference",
      capacity: null,
      remoteCapacity: null,
      visibility: "public",
      kind: "session",
    });
    const effects = () =>
      Promise.all(
        [
          "SELECT event_id,revision,published_revision,updated_at FROM event_agenda_state ORDER BY event_id",
          "SELECT id,title,description,admission_policy,capacity,remote_capacity,visibility,kind FROM event_agenda_occurrences ORDER BY id",
          "SELECT id,actor_id,action,details_json FROM audit_log ORDER BY id",
          "SELECT id,resource_id,revision,reason_code,status FROM site_publication_requests ORDER BY id",
          "SELECT id,template_key,status,payload_json FROM email_outbox ORDER BY id",
        ].map((sql) => queryAll(env.DB, sql)),
      );
    const before = await effects();
    const stale = await request({
      expectedRevision: 1,
      title: "Lost concurrent edit",
      description: original.description,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "AGENDA_REVISION_CHANGED" } });
    expect(await effects()).toEqual(before);
  });
});
