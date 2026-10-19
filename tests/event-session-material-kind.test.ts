import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { agendaOccurrenceCreateSchema, agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import { sessionHistoryMetadataSchema, sessionMaterialSchema } from "../assets/shared/schemas/event-session-history";
import { saveSessionHistory } from "../functions/_lib/services/event-agenda/history";
import { createAgendaOccurrence } from "../functions/_lib/services/event-agenda/mutations";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

describe("presentation bindings and external media release", () => {
  beforeEach(async () => resetDb());
  it("rejects mixed media bindings without writes and keeps published slides frozen during a recording edit", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    const token = await createAdminSession(env.DB, admin!.id, "material-kind");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const base = "/api/v1/events/pqc-2026/agenda";
    const initial = await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: 0,
        title: "Reviewed media",
        description: "Reviewed media about certificate lifecycle operations.",
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
        roomId: null,
        speakerUserIds: [],
      }),
    );
    const occurrenceId = initial.occurrences[0]!.id;
    const material = sessionMaterialSchema.parse({
      id: "media",
      kind: "presentation",
      title: "Reviewed slides",
      url: "/materials/slides.pdf",
      presentationVersionId: null,
      version: 1,
      rightsConfirmed: true,
      consentConfirmed: true,
      validated: true,
      status: "approved",
      approvedAt: "2026-10-03T00:00:00.000Z",
    });
    const history = sessionHistoryMetadataSchema.parse({ materials: [material] });
    const released = await saveSessionHistory(
      env.DB,
      eventId,
      "pqc-2026",
      occurrenceId,
      initial.revision,
      history,
      admin!.id,
    );
    const publication = await callApi(env, `${base}/publications`, {
      method: "POST",
      headers,
      body: JSON.stringify({ expectedRevision: released.revision }),
    });
    expect(publication.status, await publication.clone().text()).toBe(200);
    const published = agendaSnapshotSchema.parse(await publication.json());
    const persisted = async () =>
      Promise.all([
        queryAll(env.DB, "SELECT revision,published_revision FROM event_agenda_state WHERE event_id=?", [eventId]),
        queryAll(env.DB, "SELECT metadata_json FROM event_agenda_session_history WHERE occurrence_id=?", [
          occurrenceId,
        ]),
        queryAll(env.DB, "SELECT presentation_url,recording_url FROM event_agenda_occurrences WHERE id=?", [
          occurrenceId,
        ]),
        queryAll(env.DB, "SELECT id,details_json FROM audit_log ORDER BY id"),
        queryAll(env.DB, "SELECT id,snapshot_json FROM event_agenda_publications WHERE event_id=? ORDER BY id", [
          eventId,
        ]),
        queryAll(env.DB, "SELECT id FROM site_publication_requests ORDER BY id"),
      ]);
    const before = await persisted();
    for (const kind of ["recording", "transcript", "captions"] as const) {
      const mixed = {
        ...material,
        kind,
        url: `https://media.example.test/${kind}`,
        presentationSource: "session" as const,
        presentationVersionId: "uploaded-pdf",
      };
      const contract = sessionMaterialSchema.safeParse(mixed);
      expect(contract.success).toBe(false);
      if (!contract.success)
        expect(contract.error.issues.map((issue) => issue.path)).toContainEqual(["presentationVersionId"]);
      const invalidHistory = { ...history, materials: [mixed] };
      const response = await callApi(env, `${base}/occurrences/${occurrenceId}/history`, {
        method: "POST",
        headers,
        body: JSON.stringify({ expectedRevision: published.revision, history: invalidHistory }),
      });
      expect(response.status).toBe(400);
      await expect(
        saveSessionHistory(env.DB, eventId, "pqc-2026", occurrenceId, published.revision, invalidHistory, admin!.id),
      ).rejects.toMatchObject({
        status: 400,
        code: "VALIDATION_ERROR",
        details: { fieldErrors: { "materials.0.presentationVersionId": expect.any(Array) } },
      });
      expect(await persisted()).toEqual(before);
    }
    const recordingUrl = "https://www.youtube.com/watch?v=AbCdEf12345&start=90";
    const edited = await saveSessionHistory(
      env.DB,
      eventId,
      "pqc-2026",
      occurrenceId,
      published.revision,
      sessionHistoryMetadataSchema.parse({
        materials: [{ ...material, kind: "recording", url: recordingUrl, status: "draft", approvedAt: null }],
      }),
      admin!.id,
    );
    expect(edited.occurrences[0]!.history!.materials[0]).toMatchObject({
      kind: "recording",
      url: recordingUrl,
      presentationVersionId: null,
      status: "draft",
    });
    expect((await persisted())[4]).toEqual(before[4]);
    expect(published.occurrences[0]!.history!.materials[0]).toMatchObject({
      kind: "presentation",
      url: material.url,
      status: "approved",
    });
  });
});
