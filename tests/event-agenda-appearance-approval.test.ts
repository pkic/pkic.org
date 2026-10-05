import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import { sessionHistoryMetadataSchema } from "../assets/shared/schemas/event-session-history";
import { individualAppearanceFixture, seedApprovedSessionAppearances } from "./helpers/agenda-appearances";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);

async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const userId = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<string>("id"))!;
  const token = await createAdminSession(env.DB, userId, "appearance-approval-time");
  const post = (path: string, body: unknown) =>
    callApi(env, `/api/v1/events/pqc-2026/agenda${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const created = await post("/occurrences", {
    expectedRevision: 0,
    title: "Explicit approval time",
    speakerUserIds: [userId],
    startAt: "2026-12-01T09:00:00.000Z",
    endAt: "2026-12-01T10:00:00.000Z",
    roomId: null,
    visibility: "public",
  });
  expect(created.status, await created.clone().text()).toBe(200);
  const agenda = agendaSnapshotSchema.parse(await created.json());
  const occurrence = agenda.occurrences[0];
  return { eventId, userId, post, agenda, occurrence };
}

async function effects(eventId: string, occurrenceId: string) {
  return {
    state: await env.DB.prepare("SELECT revision,published_revision FROM event_agenda_state WHERE event_id=?")
      .bind(eventId)
      .first(),
    history: await env.DB.prepare("SELECT metadata_json FROM event_agenda_session_history WHERE occurrence_id=?")
      .bind(occurrenceId)
      .first("metadata_json"),
    publications: (await env.DB.prepare("SELECT snapshot_json FROM event_agenda_publications ORDER BY revision").all())
      .results,
    audits: await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log").first("count"),
    outbox: await env.DB.prepare("SELECT COUNT(*) AS count FROM email_outbox").first("count"),
    publicationRequests: await env.DB.prepare("SELECT COUNT(*) AS count FROM site_publication_requests").first("count"),
  };
}

describe("appearance approval timestamps", () => {
  it("refuses a future approval through the mounted history route without writes", async () => {
    const f = await fixture();
    const history = sessionHistoryMetadataSchema.parse({
      ...f.occurrence.history,
      appearances: [
        individualAppearanceFixture({
          userId: f.userId,
          displayName: "Verified individual",
          approvedAt: new Date(Date.now() + 86400000).toISOString(),
        }),
      ],
    });
    const before = await effects(f.eventId, f.occurrence.id);
    const response = await f.post(`/occurrences/${f.occurrence.id}/history`, {
      expectedRevision: f.agenda.revision,
      history,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "APPEARANCE_APPROVAL_IN_FUTURE" } });
    expect(await effects(f.eventId, f.occurrence.id)).toEqual(before);
    const publication = await f.post("/publications", { expectedRevision: f.agenda.revision });
    expect(publication.status).toBe(422);
    expect(await publication.json()).toMatchObject({ error: { code: "AGENDA_REPRESENTATION_REVIEW_REQUIRED" } });
    expect(await effects(f.eventId, f.occurrence.id)).toEqual(before);
  });

  it("defensively refuses a stored future approval while preserving the previous publication", async () => {
    const f = await fixture();
    const appearance = individualAppearanceFixture({
      userId: f.userId,
      displayName: "Verified individual",
      approvedAt: new Date(Date.now() - 1000).toISOString(),
    });
    const saved = await f.post(`/occurrences/${f.occurrence.id}/history`, {
      expectedRevision: f.agenda.revision,
      history: sessionHistoryMetadataSchema.parse({ ...f.occurrence.history, appearances: [appearance] }),
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const reviewed = agendaSnapshotSchema.parse(await saved.json());
    const published = await f.post("/publications", { expectedRevision: reviewed.revision });
    expect(published.status, await published.clone().text()).toBe(200);
    const initialPublication = agendaSnapshotSchema.parse(await published.json());
    expect(initialPublication.occurrences[0].history?.appearances[0]).toEqual(appearance);
    const correction = await f.post(`/occurrences/${f.occurrence.id}/history`, {
      expectedRevision: initialPublication.revision,
      history: sessionHistoryMetadataSchema.parse({
        ...initialPublication.occurrences[0].history,
        appearances: [{ ...appearance, biography: "Reviewed correction" }],
      }),
    });
    expect(correction.status, await correction.clone().text()).toBe(200);
    const corrected = agendaSnapshotSchema.parse(await correction.json());
    // Simulate invalid stored metadata arriving outside the history-saving use case.
    await seedApprovedSessionAppearances(env.DB, {
      occurrenceId: f.occurrence.id,
      reviewerId: f.userId,
      appearances: [{ ...appearance, approvedAt: new Date(Date.now() + 86400000).toISOString() }],
    });
    const before = await effects(f.eventId, f.occurrence.id);
    const refused = await f.post("/publications", { expectedRevision: corrected.revision });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: { code: "APPEARANCE_APPROVAL_IN_FUTURE" } });
    expect(await effects(f.eventId, f.occurrence.id)).toEqual(before);
    expect(before.publications).toHaveLength(1);
  });
});
