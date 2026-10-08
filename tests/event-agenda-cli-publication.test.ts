import { createHash } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resolveLegacyAgendaRow } from "../scripts/lib/legacy-agenda-decisions.mjs";
import { agendaPublicationSchema, agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import {
  agendaTransferSchema,
  transferPrepareSchema,
  transferReviewSchema,
  transferApplySchema,
  transferApplyResponseSchema,
} from "../assets/shared/schemas/event-agenda-transfer";
import { apiErrorPayloadSchema } from "../assets/shared/schemas/api-common";
import {
  agendaContentPatchSchema,
  agendaContentSchema,
  agendaContentsResponseSchema,
} from "../assets/shared/schemas/event-agenda-content";
import { agendaContentSourceSnapshotSchema } from "../assets/shared/schemas/event-agenda-source-snapshot";
import { publicSessionCredits } from "../assets/shared/session-public-credits";
import { historicalAgendaReviewInput } from "./helpers/historical-agenda-review";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { resetDb } from "./helpers/reset-db";

const sourcePath = "content/events/historical/_index.md";
const sourceDigest = "a".repeat(64);
const reviewedAt = "2023-04-02T00:00:00.000Z";

async function fixture() {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  await env.DB.prepare(
    "UPDATE events SET slug='historical',timezone='UTC',visibility='public',source_path=?,starts_at='2023-04-01T00:00:00.000Z',ends_at='2023-04-02T00:00:00.000Z' WHERE id=?",
  )
    .bind("/events/historical/", eventId)
    .run();
  const token = await createAdminSession(env.DB, admin.id, "cli-row-publication");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const request = (path: string, body: unknown, method = "POST") =>
    callApi(env, `/api/v1/events/historical/agenda${path}`, {
      method,
      headers,
      body: JSON.stringify(body),
    });
  const value = historicalAgendaReviewInput({
    actor: admin.id,
    sourcePath,
    sourceDigest,
    sourceLocator: "talk",
    approvedAt: reviewedAt,
  });
  value.document.people = value.document.people.filter((person) => person.canonicalUserId === null);
  const template = value.document.occurrences[0]!;
  template.personRefs = ["Authored speaker"];
  template.archive!.appearances = [];
  template.archive!.materials = [];
  template.archive!.legacyPaths = [];
  const emitted = [0, 1].map((sessionIndex) =>
    resolveLegacyAgendaRow(
      { title: " ", speakers: ["Authored speaker", "TBC"] },
      {
        sourcePath,
        sourceDigest,
        date: "2023-04-01",
        slotIndex: 0,
        sessionIndex,
        originalSourceKey: `legacy:${createHash("sha256").update(`${sourcePath}:2023-04-01:10:00:${sessionIndex}`).digest("hex")}`,
        title: " ",
      },
      {
        archivePublicSource: true,
        sourceRows: {
          [`2023-04-01:0:${sessionIndex}`]: {
            sourceDigest,
            title: { decision: "title_not_recorded", reviewedAt },
            credits: {
              "Authored speaker": { decision: "retain_source_credit", reviewedAt },
              TBC: { decision: "credit_not_recorded", reviewedAt },
            },
          },
        },
      },
    ),
  );
  value.document.occurrences = emitted.map((resolved) => {
    expect(resolved.unresolved).toEqual([]);
    const row = structuredClone(template);
    row.ref = resolved.sourceKey;
    row.sourceKey = resolved.sourceKey;
    row.sourceAnchor = null;
    row.fields.title = resolved.title;
    row.personRefs = resolved.names;
    row.archive!.sourceDecisions = resolved.decisions;
    return row;
  });
  return { eventId, request, value: transferPrepareSchema.parse(value), headers, emitted };
}

async function effects() {
  return Promise.all(
    [
      "SELECT event_id,revision,published_revision,updated_at FROM event_agenda_state ORDER BY event_id",
      "SELECT id,event_id,revision,snapshot_json,created_by,created_at FROM event_agenda_publications ORDER BY id",
      "SELECT event_id,revision,occurrence_id,payload_json,room_json FROM event_agenda_published_occurrences ORDER BY event_id,revision,occurrence_id",
      "SELECT id,event_id,content_id,source_key,start_at,end_at FROM event_agenda_occurrences ORDER BY id",
      "SELECT occurrence_id,metadata_json,updated_by,updated_at FROM event_agenda_session_history ORDER BY occurrence_id",
      "SELECT occurrence_id,import_mode,source_path,source_digest,source_ref,timing_json,people_json FROM event_agenda_import_provenance ORDER BY occurrence_id",
      "SELECT id,event_id,source_key,source_snapshot_json,source_review_json FROM event_agenda_contents ORDER BY id",
      "SELECT event_id,revision,occurrence_id,user_id,attendance_mode,room_id,sources_json FROM event_agenda_operational_people ORDER BY event_id,revision,occurrence_id,user_id",
      "SELECT event_id,revision,day_date,user_id,sources_json FROM event_agenda_operational_days ORDER BY event_id,revision,day_date,user_id",
      "SELECT id,actor_id,action,details_json FROM audit_log ORDER BY id",
      "SELECT id,resource_id,revision,reason_code,status FROM site_publication_requests ORDER BY id",
      "SELECT id,template_key,status,payload_json FROM email_outbox ORDER BY id",
    ].map((sql) => queryAll(env.DB, sql)),
  );
}

async function authority() {
  return Promise.all(
    [
      "SELECT id,email,normalized_email FROM users ORDER BY id",
      "SELECT id,user_id,organization_id,source,job_title FROM identities ORDER BY id",
      "SELECT id,name FROM organizations ORDER BY id",
      "SELECT id,organization_id,user_id FROM members ORDER BY id",
      "SELECT identity_id,member_id,member_status FROM identity_member_capacities ORDER BY identity_id,member_id",
      "SELECT id,user_id,role_id,context_type,context_id FROM user_roles ORDER BY id",
      "SELECT occurrence_id,user_id FROM event_agenda_occurrence_speakers ORDER BY occurrence_id,user_id",
      "SELECT event_id,revision,occurrence_id,user_id,attendance_mode,room_id FROM event_agenda_operational_people ORDER BY event_id,revision,occurrence_id,user_id",
      "SELECT event_id,revision,day_date,user_id FROM event_agenda_operational_days ORDER BY event_id,revision,day_date,user_id",
    ].map((sql) => queryAll(env.DB, sql)),
  );
}

async function apply(context: Awaited<ReturnType<typeof fixture>>, value = context.value) {
  const response = await context.request("/transfers/reviews", transferPrepareSchema.parse(value));
  expect(response.status, await response.clone().text()).toBe(200);
  const reviewed = transferReviewSchema.parse(await response.json());
  expect(reviewed.ready, JSON.stringify(reviewed.findings)).toBe(true);
  const imported = await context.request(
    "/transfers",
    transferApplySchema.parse({
      ...value,
      reviewDigest: reviewed.digest,
      acknowledgeInferredTiming: true,
      acknowledgeArchiveRepresentation: true,
    }),
  );
  expect(imported.status, await imported.clone().text()).toBe(200);
  return transferApplyResponseSchema.parse(await imported.json()).agenda;
}

async function publish(context: Awaited<ReturnType<typeof fixture>>, revision: number) {
  const response = await context.request(
    "/publications",
    agendaPublicationSchema.parse({ expectedRevision: revision, acknowledgeArchiveRepresentation: true }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return agendaSnapshotSchema.parse(await response.json());
}

beforeEach(resetDb);

it("publishes exact CLI-emitted row decisions without creating canonical people or authority", async () => {
  const context = await fixture();
  const before = await authority();
  const imported = await apply(context);
  const published = await publish(context, imported.revision);
  expect(published.occurrences).toHaveLength(2);
  const provenance = await queryAll<{ source_ref: string; source_path: string; source_digest: string }>(
    env.DB,
    "SELECT source_ref,source_path,source_digest FROM event_agenda_import_provenance ORDER BY source_ref",
  );
  expect(provenance).toEqual(
    context.value.document.occurrences
      .map((row) => ({ source_ref: row.ref, source_path: sourcePath, source_digest: sourceDigest }))
      .sort((a, b) => a.source_ref.localeCompare(b.source_ref)),
  );
  for (const source of context.value.document.occurrences) {
    const occurrence = published.occurrences.find(
      (row) => row.history?.sourceDecisions[0]?.sourceLocator === source.ref,
    )!;
    expect(occurrence.history!.sourceDecisions).toEqual(source.archive!.sourceDecisions);
    expect(occurrence.history!.archivalCredits).toEqual(source.archive!.archivalCredits);
    expect(publicSessionCredits(occurrence)).toEqual(source.archive!.archivalCredits);
    expect(occurrence.speakers).toEqual([]);
  }
  expect(context.emitted.map((row) => row.sourceRow.sourceLocator)).toEqual(["2023-04-01:0:0", "2023-04-01:0:1"]);
  expect(await authority()).toEqual(before);
});

it("refuses another real row's locator with the same path and digest at review and apply with no writes", async () => {
  const context = await fixture();
  const [row, other] = context.value.document.occurrences;
  row!.archive!.sourceDecisions[0]!.sourceLocator = other!.ref;
  const before = await effects();
  const response = await context.request("/transfers/reviews", transferPrepareSchema.parse(context.value));
  expect(response.status).toBe(200);
  const reviewed = transferReviewSchema.parse(await response.json());
  expect(reviewed.ready).toBe(false);
  expect(reviewed.findings).toContainEqual(
    expect.objectContaining({ rowRef: row!.ref, field: "archive", code: "invalid_reference", severity: "blocking" }),
  );
  expect(await effects()).toEqual(before);
  const rejected = await context.request(
    "/transfers",
    transferApplySchema.parse({
      ...context.value,
      reviewDigest: reviewed.digest,
      acknowledgeInferredTiming: true,
      acknowledgeArchiveRepresentation: true,
    }),
  );
  expect(rejected.status).toBe(409);
  expect(apiErrorPayloadSchema.parse(await rejected.json()).error.code).toBe("AGENDA_TRANSFER_REVIEW_REQUIRED");
  expect(await effects()).toEqual(before);
});

it("exports and reimports portable receipts without rewriting exact CLI review locators", async () => {
  const context = await fixture();
  const before = await authority();
  const imported = await apply(context);
  const response = await callApi(env, "/api/v1/events/historical/agenda/transfers/exports?limit=100", {
    headers: context.headers,
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const document = agendaTransferSchema.parse(await response.json());
  expect(document.source.kind).toBe("portable");
  expect(document.occurrences).toHaveLength(2);
  for (const source of context.value.document.occurrences) {
    const row = document.occurrences.find((item) => item.sourceKey === source.sourceKey)!;
    expect(row.ref).not.toBe(source.ref);
    expect(row.retainedSourceEvidence).toContainEqual({ sourcePath, sourceDigest, sourceRef: source.ref });
    expect(row.archive!.sourceDecisions).toEqual(source.archive!.sourceDecisions);
  }
  const roundtrip = transferPrepareSchema.parse({ ...context.value, expectedRevision: imported.revision, document });
  const reimported = await apply(context, roundtrip);
  expect(reimported.occurrences.map((row) => row.id).sort()).toEqual(imported.occurrences.map((row) => row.id).sort());
  const published = await publish(context, reimported.revision);
  for (const source of context.value.document.occurrences) {
    const row = published.occurrences.find((item) => item.history?.sourceDecisions[0]?.sourceLocator === source.ref)!;
    expect(row.history!.sourceDecisions).toEqual(source.archive!.sourceDecisions);
    expect(row.history!.archivalCredits).toEqual(source.archive!.archivalCredits);
  }
  expect(await authority()).toEqual(before);
});

/** Prior CLI imports stored human review coordinates; only that historical format is modeled here. */
async function stageLegacyCorrection(context: Awaited<ReturnType<typeof fixture>>, changedBiography = false) {
  const original = await apply(context);
  for (const resolved of context.emitted) {
    const occurrence = original.occurrences.find(
      (row) => row.history?.sourceDecisions[0]?.sourceLocator === resolved.sourceKey,
    )!;
    const old = structuredClone(occurrence.history!);
    old.sourceDecisions = old.sourceDecisions.map((decision) => ({
      ...decision,
      sourceLocator: resolved.sourceRow.sourceLocator,
    }));
    await env.DB.prepare("UPDATE event_agenda_session_history SET metadata_json=? WHERE occurrence_id=?")
      .bind(JSON.stringify(old), occurrence.id)
      .run();
  }
  const corrected = transferPrepareSchema.parse({ ...context.value, expectedRevision: original.revision });
  if (changedBiography)
    corrected.document.occurrences[0]!.archive!.archivalCredits[0]!.biography = "Changed source biography";
  const staged = await apply(context, corrected);
  const response = await callApi(env, "/api/v1/events/historical/agenda/contents?limit=25&offset=0", {
    headers: context.headers,
  });
  expect(response.status).toBe(200);
  const contents = agendaContentsResponseSchema.parse(await response.json()).contents;
  expect(contents).toHaveLength(2);
  expect(contents.every((content) => content.review?.incomingHistoricalMetadata?.length === 1)).toBe(true);
  return { staged, contents, corrected };
}

it("accepts a CLI locator-only correction while retaining source-only credits, missing-title/credit decisions and original receipts", async () => {
  const context = await fixture();
  const before = await authority();
  const { staged, contents } = await stageLegacyCorrection(context);
  let revision = staged.revision;
  for (const content of contents) {
    const entry = content.review!.incomingHistoricalMetadata![0]!;
    expect(entry.reviewIssues).toEqual([]);
    const resolved = context.emitted.find((row) => row.sourceKey === entry.sourceKey)!;
    expect(entry.originalSource).toEqual({ sourcePath, sourceDigest, sourceRef: resolved.sourceKey });
    expect(
      entry.originalMetadata.sourceDecisions.every(
        (decision) => decision.sourceLocator === resolved.sourceRow.sourceLocator,
      ),
    ).toBe(true);
    expect(entry.incomingMetadata).toEqual({
      ...entry.originalMetadata,
      sourceDecisions: entry.originalMetadata.sourceDecisions.map((decision) => ({
        ...decision,
        sourceLocator: resolved.sourceKey,
      })),
    });
    const accepted = await context.request(
      `/contents/${content.id}`,
      agendaContentPatchSchema.parse({
        expectedRevision: revision,
        content: content.review!.incoming,
        resolveSourceReview: true,
      }),
      "PATCH",
    );
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect(agendaContentSchema.parse(await accepted.json()).review).toBeNull();
    const snapshot = await env.DB.prepare("SELECT source_snapshot_json FROM event_agenda_contents WHERE id=?")
      .bind(content.id)
      .first<string>("source_snapshot_json");
    const evidence = agendaContentSourceSnapshotSchema.parse(JSON.parse(snapshot!)).originalHistoricalMetadataEvidence!;
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.originalSource).toEqual(entry.originalSource);
    expect(evidence[0]!.originalMetadata).toEqual(entry.originalMetadata);
    const current = await callApi(env, "/api/v1/events/historical/agenda", { headers: context.headers });
    expect(current.status).toBe(200);
    revision = agendaSnapshotSchema.parse(await current.json()).revision;
  }
  const published = await publish(context, revision);
  for (const source of context.value.document.occurrences) {
    const row = published.occurrences.find((item) => item.history?.sourceDecisions[0]?.sourceLocator === source.ref)!;
    expect(row.history!.archivalCredits).toEqual(source.archive!.archivalCredits);
    expect(row.history!.sourceDecisions).toEqual(source.archive!.sourceDecisions);
    expect(row).toMatchObject({
      title: "Title not recorded",
      startAt: source.timing.startAt,
      endAt: source.timing.endAt,
      speakers: [],
    });
  }
  expect(await authority()).toEqual(before);
});

it("refuses changed biography bundled with a locator correction without accepting any staged facts", async () => {
  const context = await fixture();
  const { staged, contents, corrected } = await stageLegacyCorrection(context, true);
  const target = corrected.document.occurrences[0]!;
  const content = contents.find((item) => item.review!.incomingHistoricalMetadata![0]!.sourceKey === target.sourceKey)!;
  expect(content.review!.incomingHistoricalMetadata![0]!.reviewIssues).toContain("archival_credit_unmapped");
  const before = { effects: await effects(), authority: await authority() };
  const response = await context.request(
    `/contents/${content.id}`,
    agendaContentPatchSchema.parse({
      expectedRevision: staged.revision,
      content: content.review!.incoming,
      resolveSourceReview: true,
    }),
    "PATCH",
  );
  expect(response.status).toBe(422);
  expect(apiErrorPayloadSchema.parse(await response.json()).error.code).toBe("AGENDA_HISTORICAL_MAPPING_REQUIRED");
  expect({ effects: await effects(), authority: await authority() }).toEqual(before);
});

it("refuses a hybrid retained path and digest with the current row locator without writes", async () => {
  const context = await fixture();
  const row = context.value.document.occurrences[0]!;
  context.value.document.source.kind = "portable";
  row.retainedSourceEvidence = [{ sourcePath: "/events/older/", sourceDigest: "b".repeat(64), sourceRef: "older-row" }];
  const decision = row.archive!.sourceDecisions[0]!;
  decision.sourcePath = row.retainedSourceEvidence[0]!.sourcePath;
  decision.sourceDigest = row.retainedSourceEvidence[0]!.sourceDigest;
  decision.sourceLocator = row.ref;
  const before = await effects();
  const response = await context.request("/transfers/reviews", transferPrepareSchema.parse(context.value));
  expect(response.status).toBe(200);
  const reviewed = transferReviewSchema.parse(await response.json());
  expect(reviewed.ready).toBe(false);
  expect(reviewed.findings).toContainEqual(
    expect.objectContaining({ rowRef: row.ref, field: "archive", code: "invalid_reference", severity: "blocking" }),
  );
  const rejected = await context.request(
    "/transfers",
    transferApplySchema.parse({
      ...context.value,
      reviewDigest: reviewed.digest,
      acknowledgeInferredTiming: true,
      acknowledgeArchiveRepresentation: true,
    }),
  );
  expect(rejected.status).toBe(409);
  expect(apiErrorPayloadSchema.parse(await rejected.json()).error.code).toBe("AGENDA_TRANSFER_REVIEW_REQUIRED");
  expect(await effects()).toEqual(before);
});
