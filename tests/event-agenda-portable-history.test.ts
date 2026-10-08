import { grantAdministrator } from "./helpers/administrator";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { individualAppearanceFixture } from "./helpers/agenda-appearances";
import { agendaOccurrenceQuerySchema } from "../assets/shared/schemas/event-agenda";
import { agendaContentsResponseSchema } from "../assets/shared/schemas/event-agenda-content";
import { agendaContentSourceSnapshotSchema } from "../assets/shared/schemas/event-agenda-source-snapshot";
import { transferPrepareSchema } from "../assets/shared/schemas/event-agenda-transfer";
import { sessionHistoryMetadataSchema } from "../assets/shared/schemas/event-session-history";
import {
  applyAgendaTransfer,
  reviewAgendaTransfer,
  exportAgendaTransfer,
} from "../functions/_lib/services/event-agenda/transfer";

const eventId = crypto.randomUUID(),
  userId = crypto.randomUUID(),
  slug = "portable-history";
const sourcePath = "/events/original-history/",
  sourceDigest = "a".repeat(64),
  reviewedAt = "2023-04-02T00:00:00.000Z";
const appearance = individualAppearanceFixture({ userId, displayName: "Verified person", approvedAt: reviewedAt });
let token = "";
function input() {
  return transferPrepareSchema.parse({
    expectedRevision: 0,
    mode: "archive",
    resolutions: { people: {}, rooms: {}, media: {}, rows: {} },
    document: {
      format: "pkic-agenda",
      version: 1,
      source: { kind: "hugo", eventRef: slug, exportedAt: reviewedAt, sourceDigest },
      rooms: [],
      people: [
        {
          ref: "Authored person",
          label: "Authored person",
          canonicalUserId: null,
          actingIdentityId: null,
          role: "speaker",
        },
      ],
      occurrences: [
        {
          ref: "talk",
          sourceKey: "legacy:portable-history:talk",
          sourceAnchor: "historical-talk",
          sourcePath,
          sourceDigest,
          fields: { title: "Historical talk", description: "Authored abstract", visibility: "public" },
          timing: {
            timeZone: "UTC",
            authoredDate: "2023-04-01",
            authoredStart: "10:00",
            startAt: "2023-04-01T10:00:00.000Z",
            endAt: "2023-04-01T11:00:00.000Z",
            endSource: "explicit",
            transitionMinutes: 0,
            transitionSource: "none",
          },
          roomRefs: [],
          personRefs: ["Authored person"],
          personRoles: { "Authored person": "speaker" },
          media: [],
          archive: sessionHistoryMetadataSchema.parse({
            archivalCredits: [
              {
                sourceRef: "Authored person",
                displayName: "Authored person",
                role: "speaker",
                jobTitle: null,
                organizationName: null,
                biography: "Authored biography",
                photoUrl: null,
                sourcePath,
                sourceDigest,
                provenance: "authored_public",
              },
            ],
          }),
        },
      ],
    },
  });
}
async function apply(value: ReturnType<typeof input>) {
  const review = await reviewAgendaTransfer(env.DB, eventId, slug, value);
  expect(review.ready, JSON.stringify(review.findings)).toBe(true);
  return applyAgendaTransfer(
    env.DB,
    eventId,
    slug,
    { ...value, reviewDigest: review.digest, acknowledgeInferredTiming: true, acknowledgeArchiveRepresentation: true },
    userId,
  );
}
const exported = () => exportAgendaTransfer(env.DB, eventId, slug, agendaOccurrenceQuerySchema.parse({ limit: 100 }));
function request(path: string, body?: unknown, method = "GET") {
  return callApi(env, `/api/v1/events/${slug}/agenda${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(async () => {
  await resetDb();
  await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
    .bind(userId, "portable@example.test", "portable@example.test")
    .run();
  await grantAdministrator(env.DB, userId);
  await env.DB.prepare(
    "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,?,?,'UTC','{}',?,?)",
  )
    .bind(eventId, slug, "Portable history", reviewedAt, reviewedAt)
    .run();
  token = await createAdminSession(env.DB, userId, crypto.randomUUID());
});

describe("durable historical portable export", () => {
  it("roundtrips legacy JSON defaults and keeps verified PDF receipts while clearing foreign uploaded selections", async () => {
    const value = input(),
      row = value.document.occurrences[0],
      url = "/events/original-history/slides.pdf",
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
    });
    const initial = await apply(value),
      occurrence = initial.agenda.occurrences[0];
    await env.DB.prepare(
      "UPDATE event_agenda_session_history SET metadata_json=json_remove(metadata_json,'$.legacyDownloads[0].pdfDigest','$.legacyDownloads[0].pdfBytes','$.materials[0].legacyDownloadUrl') WHERE occurrence_id=?",
    )
      .bind(occurrence.id)
      .run();
    await env.DB.prepare(
      "UPDATE event_agenda_import_provenance SET media_json=json_remove(media_json,'$[0].bytes') WHERE occurrence_id=?",
    )
      .bind(occurrence.id)
      .run();
    const legacyDocument = await exported();
    expect(legacyDocument.occurrences[0].archive!.legacyDownloads[0]).toMatchObject({
      pdfDigest: null,
      pdfBytes: null,
    });
    expect(legacyDocument.occurrences[0].archive!.materials[0].legacyDownloadUrl).toBeNull();
    expect(legacyDocument.occurrences[0].media[0].bytes).toBeNull();
    const unchanged = await apply(
      transferPrepareSchema.parse({ ...value, expectedRevision: initial.agenda.revision, document: legacyDocument }),
    );
    expect(unchanged.imported).toBe(0);
    // A source event's selected version and release rights cannot authorize a target event's material.
    const document = await exported(),
      archived = document.occurrences[0],
      receipt = { ...archived.archive!.legacyDownloads[0], pdfDigest, pdfBytes };
    archived.archive!.legacyDownloads = [receipt];
    archived.archive!.materials = [
      {
        ...archived.archive!.materials[0],
        url: "",
        presentationVersionId: crypto.randomUUID(),
        legacyDownloadUrl: url,
        presentationSource: "session",
        status: "approved",
        approvedAt: reviewedAt,
        rightsConfirmed: true,
        consentConfirmed: true,
        validated: true,
      },
    ];
    archived.media[0] = { ...archived.media[0], sourceDigest: pdfDigest, bytes: pdfBytes };
    const targetId = crypto.randomUUID(),
      targetSlug = "fresh-pdf-target";
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,?,?,'UTC','{}',?,?)",
    )
      .bind(targetId, targetSlug, "Fresh PDF target", reviewedAt, reviewedAt)
      .run();
    const incoming = transferPrepareSchema.parse({ ...value, expectedRevision: 0, document });
    const review = await reviewAgendaTransfer(env.DB, targetId, targetSlug, incoming);
    expect(review.ready, JSON.stringify(review.findings)).toBe(true);
    const imported = await applyAgendaTransfer(
      env.DB,
      targetId,
      targetSlug,
      {
        ...incoming,
        reviewDigest: review.digest,
        acknowledgeInferredTiming: true,
        acknowledgeArchiveRepresentation: true,
      },
      userId,
    );
    expect(imported.agenda.occurrences[0].history).toMatchObject({
      legacyDownloads: [receipt],
      materials: [
        expect.objectContaining({
          url: targetUrl,
          presentationVersionId: null,
          legacyDownloadUrl: null,
          presentationSource: "proposal",
          rightsConfirmed: false,
          consentConfirmed: false,
          validated: false,
          status: "draft",
          approvedAt: null,
        }),
      ],
    });
    const targetExport = await exportAgendaTransfer(
      env.DB,
      targetId,
      targetSlug,
      agendaOccurrenceQuerySchema.parse({ limit: 100 }),
    );
    expect(targetExport.occurrences[0].archive!.legacyDownloads).toEqual([receipt]);
    expect(targetExport.occurrences[0].media[0]).toMatchObject({ sourceDigest: pdfDigest, bytes: pdfBytes });
    const copied = transferPrepareSchema.parse({
      ...incoming,
      mode: "copy_as_new",
      expectedRevision: imported.agenda.revision,
      resolutions: { ...incoming.resolutions, people: { "Authored person": { userId, actingIdentityId: null } } },
    });
    const copyReview = await reviewAgendaTransfer(env.DB, targetId, targetSlug, copied);
    expect(copyReview.ready, JSON.stringify(copyReview.findings)).toBe(true);
    await applyAgendaTransfer(
      env.DB,
      targetId,
      targetSlug,
      {
        ...copied,
        reviewDigest: copyReview.digest,
        acknowledgeInferredTiming: true,
        acknowledgeArchiveRepresentation: true,
      },
      userId,
    );
    const copyHistory = await env.DB.prepare(
      "SELECT history.metadata_json FROM event_agenda_session_history history JOIN event_agenda_occurrences occurrence ON occurrence.id=history.occurrence_id WHERE occurrence.event_id=? AND occurrence.source_key LIKE 'copy:%'",
    )
      .bind(targetId)
      .first<string>("metadata_json");
    expect(sessionHistoryMetadataSchema.parse(JSON.parse(copyHistory!))).toMatchObject({
      legacyDownloads: [],
      materials: [expect.objectContaining({ presentationVersionId: null, legacyDownloadUrl: null, status: "draft" })],
    });
    expect(sessionHistoryMetadataSchema.safeParse({ legacyDownloads: [{ ...receipt, pdfBytes: null }] }).success).toBe(
      false,
    );
  });
  it("persists mixed original and current receipts when a portable archive enters a fresh target event", async () => {
    const value = input(),
      row = value.document.occurrences[0];
    const targetId = crypto.randomUUID(),
      targetSlug = "fresh-portable-target";
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,?,?,'UTC','{}',?,?)",
    )
      .bind(targetId, targetSlug, "Fresh portable target", reviewedAt, reviewedAt)
      .run();
    const latestPath = "/events/current-source/",
      latestDigest = "b".repeat(64);
    const receipts = [
      { sourcePath, sourceDigest, sourceRef: "original-authored-row" },
      { sourcePath: latestPath, sourceDigest: latestDigest, sourceRef: "current-authored-row" },
    ];
    value.document.source.kind = "portable";
    value.document.source.sourceDigest = latestDigest;
    row.sourcePath = latestPath;
    row.sourceDigest = latestDigest;
    row.retainedSourceEvidence = receipts;
    row.timing.endAt = null;
    row.timing.endSource = "unresolved";
    row.archive!.archivalTiming = {
      sourcePath,
      sourceDigest,
      provenance: "authored_public",
      timeZone: "UTC",
      authoredDate: row.timing.authoredDate,
      authoredStart: row.timing.authoredStart,
      startAt: row.timing.startAt!,
      endAt: null,
    };
    row.archive!.sourceDecisions = [
      {
        kind: "title",
        sourcePath: latestPath,
        sourceDigest: latestDigest,
        sourceLocator: "2023-04-01:0:0",
        authoredValue: "Historical talk",
        decision: "reviewed_title",
        resolvedValue: row.fields.title,
        reviewedAt,
      },
    ];
    const review = await reviewAgendaTransfer(env.DB, targetId, targetSlug, value);
    expect(review.ready, JSON.stringify(review.findings)).toBe(true);
    const initial = await applyAgendaTransfer(
      env.DB,
      targetId,
      targetSlug,
      {
        ...value,
        reviewDigest: review.digest,
        acknowledgeInferredTiming: true,
        acknowledgeArchiveRepresentation: true,
      },
      userId,
    );
    const stored = await env.DB.prepare("SELECT source_snapshot_json FROM event_agenda_contents WHERE event_id=?")
      .bind(targetId)
      .first<{ source_snapshot_json: string }>();
    expect(
      agendaContentSourceSnapshotSchema.parse(JSON.parse(stored!.source_snapshot_json)).retainedSourceEvidence,
    ).toEqual(receipts);
    const document = await exportAgendaTransfer(
      env.DB,
      targetId,
      targetSlug,
      agendaOccurrenceQuerySchema.parse({ limit: 100 }),
    );
    expect(document.occurrences[0]).toMatchObject({
      sourcePath: latestPath,
      sourceDigest: latestDigest,
      retainedSourceEvidence: receipts,
    });
    expect(document.occurrences[0].archive!.archivalTiming).toEqual(row.archive!.archivalTiming);
    expect(document.occurrences[0].archive!.archivalCredits).toEqual(row.archive!.archivalCredits);
    const repeated = transferPrepareSchema.parse({ ...value, expectedRevision: initial.agenda.revision, document });
    const repeatedReview = await reviewAgendaTransfer(env.DB, targetId, targetSlug, repeated);
    expect(repeatedReview.ready).toBe(true);
    const reapplied = await applyAgendaTransfer(
      env.DB,
      targetId,
      targetSlug,
      {
        ...repeated,
        reviewDigest: repeatedReview.digest,
        acknowledgeInferredTiming: true,
        acknowledgeArchiveRepresentation: true,
      },
      userId,
    );
    expect(reapplied.imported).toBe(0);
    const secondExport = await exportAgendaTransfer(
      env.DB,
      targetId,
      targetSlug,
      agendaOccurrenceQuerySchema.parse({ limit: 100 }),
    );
    expect(secondExport.occurrences[0].retainedSourceEvidence).toEqual(receipts);
    expect(
      (
        await reviewAgendaTransfer(
          env.DB,
          targetId,
          targetSlug,
          transferPrepareSchema.parse({
            ...value,
            expectedRevision: reapplied.agenda.revision,
            document: secondExport,
          }),
        )
      ).ready,
    ).toBe(true);
  });
  it("roundtrips a shared authored person with a distinct role on each occurrence", async () => {
    const value = input(),
      second = structuredClone(value.document.occurrences[0]);
    second.ref = "moderated-talk";
    second.sourceKey = "legacy:portable-history:moderated-talk";
    second.sourceAnchor = "moderated-talk";
    second.fields.title = "Moderated talk";
    second.timing.startAt = "2023-04-01T12:00:00.000Z";
    second.timing.endAt = "2023-04-01T13:00:00.000Z";
    second.personRoles["Authored person"] = "moderator";
    second.archive!.archivalCredits[0].role = "moderator";
    value.document.occurrences.push(second);
    const initial = await apply(value),
      document = await exported();
    expect(document.occurrences.map((row) => row.personRoles["Authored person"]).sort()).toEqual([
      "moderator",
      "speaker",
    ]);
    const repeated = transferPrepareSchema.parse({ ...value, expectedRevision: initial.agenda.revision, document });
    expect((await reviewAgendaTransfer(env.DB, eventId, slug, repeated)).ready).toBe(true);
    expect(
      (await apply(repeated)).agenda.occurrences.map((row) => row.history!.archivalCredits[0].role).sort(),
    ).toEqual(["moderator", "speaker"]);
  });
  it("retains an exact reviewed placeholder binding on a first import and portable roundtrip", async () => {
    const value = input(),
      row = value.document.occurrences[0];
    value.document.people[0] = {
      ref: "Verified person reference",
      label: "Verified person",
      canonicalUserId: userId,
      actingIdentityId: null,
      role: "moderator",
    };
    row.personRefs = ["Verified person reference"];
    row.personRoles = { "Verified person reference": "moderator" };
    row.archive = sessionHistoryMetadataSchema.parse({
      appearances: [appearance],
      sourceDecisions: [
        {
          kind: "credit",
          sourcePath,
          sourceDigest,
          sourceLocator: "2023-04-01:0:0",
          authoredValue: "TBC",
          decision: "reviewed_credit",
          resolvedValue: "Verified person reference",
          reviewedAt,
        },
      ],
    });
    const initial = await apply(value),
      document = await exported();
    expect(document.occurrences[0].personRefs).toEqual(["Verified person reference"]);
    expect(document.occurrences[0].archive!.sourceDecisions).toEqual(row.archive.sourceDecisions);
    expect(
      (
        await reviewAgendaTransfer(
          env.DB,
          eventId,
          slug,
          transferPrepareSchema.parse({ ...value, expectedRevision: initial.agenda.revision, document }),
        )
      ).ready,
    ).toBe(true);
    const provenance = await env.DB.prepare(
      "SELECT people_json FROM event_agenda_import_provenance WHERE occurrence_id=?",
    )
      .bind(initial.agenda.occurrences[0].id)
      .first<{ people_json: string }>();
    expect(JSON.parse(provenance!.people_json)[0]).toMatchObject({
      sourceRef: "Verified person reference",
      userId,
      actingIdentityId: null,
    });
    await env.DB.prepare("UPDATE event_agenda_import_provenance SET people_json=? WHERE occurrence_id=?")
      .bind(JSON.stringify([{ userId, actingIdentityId: null }]), initial.agenda.occurrences[0].id)
      .run();
    await expect(exported()).rejects.toMatchObject({ code: "AGENDA_EXPORT_SOURCE_MAPPING_REQUIRED" });
  });
  it.each([false, true])(
    "exports the latest source and retains typed original evidence (partial timing: %s)",
    async (partial) => {
      const value = input(),
        row = value.document.occurrences[0];
      if (partial) {
        row.timing.endAt = null;
        row.timing.endSource = "unresolved";
        row.archive!.archivalTiming = {
          sourcePath,
          sourceDigest,
          provenance: "authored_public",
          timeZone: "UTC",
          authoredDate: row.timing.authoredDate,
          authoredStart: row.timing.authoredStart,
          startAt: row.timing.startAt!,
          endAt: null,
        };
      }
      const originalTiming = row.archive!.archivalTiming;
      const initial = await apply(value),
        originalOccurrence = initial.agenda.occurrences[0];
      const latestDigest = "b".repeat(64),
        latestPath = "/events/revised-history/";
      value.expectedRevision = initial.agenda.revision;
      value.document.source.sourceDigest = latestDigest;
      row.sourceDigest = latestDigest;
      row.sourcePath = latestPath;
      row.fields.title = "Verified historical title";
      value.document.people[0] = {
        ref: "Authored person",
        label: "Verified person",
        canonicalUserId: userId,
        actingIdentityId: null,
        role: "speaker",
      };
      row.archive = sessionHistoryMetadataSchema.parse({
        appearances: [appearance],
        archivalTiming: originalTiming
          ? { ...originalTiming, sourcePath: latestPath, sourceDigest: latestDigest }
          : null,
        sourceDecisions: [
          {
            kind: "title",
            sourcePath: latestPath,
            sourceDigest: latestDigest,
            sourceLocator: "2023-04-01:0:0",
            authoredValue: "Historical talk",
            decision: "reviewed_title",
            resolvedValue: row.fields.title,
            reviewedAt,
          },
        ],
      });
      const staged = await apply(value);
      const response = await request("/contents?limit=25&offset=0");
      expect(response.status).toBe(200);
      const pending = agendaContentsResponseSchema.parse(await response.json()).contents[0];
      const accepted = await request(
        `/contents/${pending.id}`,
        { expectedRevision: staged.agenda.revision, content: pending.review!.incoming, resolveSourceReview: true },
        "PATCH",
      );
      expect(accepted.status, await accepted.clone().text()).toBe(200);
      const source = await env.DB.prepare("SELECT source_snapshot_json FROM event_agenda_contents WHERE id=?")
        .bind(pending.id)
        .first<{ source_snapshot_json: string }>();
      const snapshot = agendaContentSourceSnapshotSchema.parse(JSON.parse(source!.source_snapshot_json));
      expect(snapshot.historicalMetadataEvidence![0]).toMatchObject({
        sourcePath: latestPath,
        sourceDigest: latestDigest,
      });
      expect(snapshot.originalHistoricalMetadataEvidence![0].originalSource).toMatchObject({
        sourcePath,
        sourceDigest,
      });
      expect(snapshot.originalHistoricalMetadataEvidence![0].originalMetadata.archivalCredits[0].displayName).toBe(
        "Authored person",
      );
      expect(
        await env.DB.prepare("SELECT source_digest FROM event_agenda_import_provenance WHERE occurrence_id=?")
          .bind(originalOccurrence.id)
          .first("source_digest"),
      ).toBe(sourceDigest);
      const document = await exported();
      expect(document.occurrences[0]).toMatchObject({
        sourcePath: latestPath,
        sourceDigest: latestDigest,
        personRefs: ["Authored person"],
      });
      expect(document.occurrences[0].retainedSourceEvidence).toEqual([
        { sourcePath, sourceDigest, sourceRef: "talk" },
        { sourcePath: latestPath, sourceDigest: latestDigest, sourceRef: "talk" },
      ]);
      if (partial) expect(document.occurrences[0].archive!.archivalTiming).toEqual(originalTiming);
      const repeated = transferPrepareSchema.parse({
        ...value,
        expectedRevision: staged.agenda.revision + 1,
        document,
      });
      expect((await reviewAgendaTransfer(env.DB, eventId, slug, repeated)).ready).toBe(true);
      expect((await apply(repeated)).agenda.occurrences[0].history!.sourceDecisions).toEqual(
        row.archive.sourceDecisions,
      );
      const preserved = await env.DB.prepare("SELECT source_snapshot_json FROM event_agenda_contents WHERE id=?")
        .bind(pending.id)
        .first<{ source_snapshot_json: string }>();
      expect(
        agendaContentSourceSnapshotSchema.parse(JSON.parse(preserved!.source_snapshot_json))
          .originalHistoricalMetadataEvidence,
      ).toEqual(snapshot.originalHistoricalMetadataEvidence);
    },
  );
});
