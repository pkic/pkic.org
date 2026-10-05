import { grantAdministrator } from "./helpers/administrator";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { historicalAgendaReviewInput, mapHistoricalAgendaSpeaker } from "./helpers/historical-agenda-review";
import { agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import { agendaContentsResponseSchema } from "../assets/shared/schemas/event-agenda-content";
import { transferReviewSchema, transferApplyResponseSchema } from "../assets/shared/schemas/event-agenda-transfer";
import { sessionHistoryMetadataSchema } from "../assets/shared/schemas/event-session-history";

const eventId = crypto.randomUUID(),
  actor = crypto.randomUUID(),
  speaker = crypto.randomUUID();
const sourcePath = "/events/historical/",
  sourceDigest = "a".repeat(64),
  sourceLocator = "2023-04-01:0:0",
  approvedAt = "2023-04-02T00:00:00.000Z";
let token = "";
const input = () => historicalAgendaReviewInput({ actor, sourcePath, sourceDigest, sourceLocator, approvedAt });
const mapSpeaker = (value: ReturnType<typeof input>) => mapHistoricalAgendaSpeaker(value, speaker, approvedAt);
function request(path: string, body: unknown, method = "POST") {
  return callApi(env, `/api/v1/events/historical/agenda${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function apply(value: ReturnType<typeof input>) {
  const checked = await request("/transfers/reviews", value);
  expect(checked.status, await checked.clone().text()).toBe(200);
  const review = transferReviewSchema.parse(await checked.json());
  expect(review.ready, JSON.stringify(review.findings)).toBe(true);
  const response = await request("/transfers", {
    ...value,
    reviewDigest: review.digest,
    acknowledgeInferredTiming: true,
    acknowledgeArchiveRepresentation: true,
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return transferApplyResponseSchema.parse(await response.json());
}
async function content() {
  const response = await callApi(env, "/api/v1/events/historical/agenda/contents?limit=25&offset=0", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  return agendaContentsResponseSchema.parse(await response.json()).contents[0];
}
async function durableState() {
  const rows = await env.DB.batch([
    env.DB.prepare("SELECT revision FROM event_agenda_state WHERE event_id=?").bind(eventId),
    env.DB.prepare(
      "SELECT metadata_json FROM event_agenda_session_history WHERE occurrence_id IN(SELECT id FROM event_agenda_occurrences WHERE event_id=?)",
    ).bind(eventId),
    env.DB.prepare("SELECT source_review_json FROM event_agenda_contents WHERE event_id=?").bind(eventId),
    env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log"),
  ]);
  const histories = rows[1]?.results;
  expect(histories).toHaveLength(1);
  const history = histories?.[0]?.metadata_json;
  expect(history).toEqual(expect.any(String));
  return { results: rows.map((row) => row.results), history };
}
beforeEach(async () => {
  await resetDb();
  for (const id of [actor, speaker])
    await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
      .bind(id, `${id}@example.test`, `${id}@example.test`)
      .run();
  await grantAdministrator(env.DB, actor);
  await env.DB.prepare(
    "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,'historical','Historical','UTC','{}',?,?)",
  )
    .bind(eventId, approvedAt, approvedAt)
    .run();
  token = await createAdminSession(env.DB, actor, crypto.randomUUID());
});
describe("verified historical PDF source review", () => {
  it("enriches an old PDF receipt only through same-source review and preserves authored evidence and material approvals", async () => {
    const value = input();
    mapSpeaker(value);
    const row = value.document.occurrences[0],
      url = "/events/historical/slides.pdf",
      targetUrl = `/content-media${url}`,
      pdfDigest = "b".repeat(64),
      pdfBytes = 123;
    row.media = [
      {
        kind: "presentation",
        authoredReference: "slides.pdf",
        publicUrl: targetUrl,
        sourceDigest: pdfDigest,
        bytes: pdfBytes,
      },
    ];
    row.archive = sessionHistoryMetadataSchema.parse({
      ...row.archive,
      legacyDownloads: [{ url, targetUrl, sourcePath, sourceDigest, sourceLocator: row.ref }],
      materials: row.archive!.materials.map((material) => ({ ...material, url: targetUrl })),
    });
    const initial = await apply(value),
      occurrence = initial.agenda.occurrences[0],
      originalReceipt = occurrence.history!.legacyDownloads[0],
      submittedMaterials = occurrence.history!.materials.map((material) => ({
        ...material,
        rightsConfirmed: true,
        consentConfirmed: true,
        validated: true,
        status: "approved" as const,
        approvedAt,
      }));
    const approved = await request(`/occurrences/${occurrence.id}/history`, {
      expectedRevision: initial.agenda.revision,
      history: { ...occurrence.history, materials: submittedMaterials },
    });
    expect(approved.status, await approved.clone().text()).toBe(200);
    const approvedAgenda = agendaSnapshotSchema.parse(await approved.json());
    const priorMaterials = structuredClone(approvedAgenda.occurrences[0].history!.materials);
    expect(priorMaterials).toHaveLength(submittedMaterials.length);
    for (const [index, material] of priorMaterials.entries()) {
      expect(material.approvedAt).toEqual(expect.any(String));
      expect(material.approvedAt).not.toBe(approvedAt);
      expect(material.approvalNonce).toEqual(expect.any(String));
      expect(material).toEqual({
        ...submittedMaterials[index],
        approvedAt: material.approvedAt,
        approvalNonce: material.approvalNonce,
      });
    }
    // Stored pre-checkpoint JSON omitted the additive fields entirely.
    await env.DB.prepare(
      "UPDATE event_agenda_session_history SET metadata_json=json_remove(metadata_json,'$.legacyDownloads[0].pdfDigest','$.legacyDownloads[0].pdfBytes') WHERE occurrence_id=?",
    )
      .bind(occurrence.id)
      .run();
    row.archive.legacyDownloads[0] = { ...originalReceipt, pdfDigest, pdfBytes };
    const ordinary = await request(`/occurrences/${occurrence.id}/history`, {
      expectedRevision: approvedAgenda.revision,
      history: { ...occurrence.history, materials: priorMaterials, legacyDownloads: row.archive.legacyDownloads },
    });
    expect(ordinary.status).toBe(400);
    expect(await ordinary.json()).toMatchObject({ error: { code: "HISTORICAL_LINK_PROVENANCE_IMMUTABLE" } });
    value.expectedRevision = approvedAgenda.revision;
    for (const mutation of [
      { pdfBytes: pdfBytes + 1 },
      { pdfDigest: "c".repeat(64) },
      { sourceDigest: "d".repeat(64) },
      { sourcePath: "/events/another-source/" },
      { sourceLocator: "another-row" },
    ]) {
      const tampered = structuredClone(value);
      Object.assign(tampered.document.occurrences[0].archive!.legacyDownloads[0], mutation);
      const checked = await request("/transfers/reviews", tampered);
      expect(transferReviewSchema.parse(await checked.json()).ready).toBe(false);
    }
    const wrongMedia = structuredClone(value);
    wrongMedia.document.occurrences[0].media[0].bytes = pdfBytes + 1;
    const checked = await request("/transfers/reviews", wrongMedia);
    expect(transferReviewSchema.parse(await checked.json()).ready).toBe(false);
    const staged = await apply(value),
      pending = await content();
    expect(staged.agenda.occurrences[0].history!.legacyDownloads).toEqual([originalReceipt]);
    expect(pending.review!.incomingHistoricalMetadata![0].originalMetadata.legacyDownloads).toEqual([originalReceipt]);
    const accepted = await request(
      `/contents/${pending.id}`,
      {
        expectedRevision: staged.agenda.revision,
        content: pending.review!.incoming,
        resolveSourceReview: true,
      },
      "PATCH",
    );
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const stored = sessionHistoryMetadataSchema.parse(JSON.parse(String((await durableState()).history)));
    expect(stored.legacyDownloads).toEqual([{ ...originalReceipt, pdfDigest, pdfBytes }]);
    expect(stored.materials).toEqual(priorMaterials);
    expect(stored.appearances).toEqual(occurrence.history!.appearances);
    value.expectedRevision = staged.agenda.revision + 1;
    row.archive.legacyDownloads[0].pdfDigest = "c".repeat(64);
    row.media[0].sourceDigest = "c".repeat(64);
    const replacement = await apply(value),
      replacementReview = await content(),
      before = await durableState();
    const refused = await request(
      `/contents/${replacementReview.id}`,
      {
        expectedRevision: replacement.agenda.revision,
        content: replacementReview.review!.incoming,
        resolveSourceReview: true,
      },
      "PATCH",
    );
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: { code: "AGENDA_HISTORICAL_LINK_CONFLICT" } });
    expect(await durableState()).toEqual(before);
  });
});
