import { patchAgendaOccurrence, publishAgenda } from "../functions/_lib/services/event-agenda/mutations";
import { grantAdministrator } from "./helpers/administrator";
import { saveSessionHistory } from "../functions/_lib/services/event-agenda/history";
import { projectLiveAgendaMaterials } from "../functions/_lib/services/site-agenda-material-eligibility";
import { agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { beforeEach, describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { individualAppearanceFixture, seedApprovedSessionAppearances } from "./helpers/agenda-appearances";
import { resetDb } from "./helpers/reset-db";
import {
  reviewAgendaTransfer,
  applyAgendaTransfer,
  exportAgendaTransfer,
} from "../functions/_lib/services/event-agenda/transfer";
import {
  sessionHistoryMetadataSchema,
  sessionSourceDecisionSchema,
} from "../assets/shared/schemas/event-session-history";
import { transferPrepareSchema } from "../assets/shared/schemas/event-agenda-transfer";
import { agendaOccurrenceQuerySchema } from "../assets/shared/schemas/event-agenda";
const eventId = crypto.randomUUID(),
  user = crypto.randomUUID(),
  room = crypto.randomUUID(),
  room2 = crypto.randomUUID();
function input() {
  return transferPrepareSchema.parse({
    expectedRevision: 0,
    mode: "archive",
    resolutions: { people: {}, rooms: {}, media: {}, rows: {} },
    document: {
      format: "pkic-agenda",
      version: 1,
      source: {
        kind: "portable",
        eventRef: "source",
        exportedAt: "2026-10-04T10:00:00.000Z",
        sourceDigest: "a".repeat(64),
      },
      people: [{ ref: "speaker", label: "Alex", canonicalUserId: user, actingIdentityId: null, role: "moderator" }],
      rooms: [
        { ref: "main", label: "Main", canonicalRoomId: room },
        { ref: "extra", label: "Extra", canonicalRoomId: room2 },
      ],
      occurrences: [
        {
          ref: "talk",
          sourceKey: "portable:talk",
          sourceAnchor: "2026-talk",
          sourcePath: "/events/source/",
          fields: {
            title: "Imported talk",
            description: "Source text",
            visibility: "public",
            kind: "session",
            admissionPolicy: "preference",
          },
          timing: {
            timeZone: "UTC",
            authoredDate: null,
            authoredStart: null,
            startAt: "2027-01-01T10:00:00.000Z",
            endAt: "2027-01-01T11:00:00.000Z",
            endSource: "explicit",
            transitionMinutes: 0,
            transitionSource: "none",
          },
          roomRefs: ["main", "extra"],
          personRefs: ["speaker"],
          media: [],
          archive: null,
        },
      ],
    },
  });
}
function sourceDecision() {
  return sessionSourceDecisionSchema.parse({
    kind: "title",
    sourcePath: "/events/source/",
    sourceDigest: "a".repeat(64),
    sourceLocator: "2023-03-03:0:0",
    authoredValue: " ",
    decision: "title_not_recorded",
    resolvedValue: "Title not recorded",
    reviewedAt: "2023-03-04T00:00:00.000Z",
  });
}
beforeEach(async () => {
  await resetDb();
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
    .bind(user, "transfer@example.test", "transfer@example.test")
    .run();
  await grantAdministrator(env.DB, user);
  await env.DB.prepare(
    "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,'transfer-test','Transfer','UTC','{}',?,?)",
  )
    .bind(eventId, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,NULL,?)",
  )
    .bind(eventId, now)
    .run();
  for (const id of [room, room2])
    await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,?,20)")
      .bind(id, eventId, id)
      .run();
});
describe("versioned reviewed agenda transfer", () => {
  it("defaults old history to no source decisions and rejects inconsistent or unbounded decisions", () => {
    expect(sessionHistoryMetadataSchema.parse({}).sourceDecisions).toEqual([]);
    const decision = sourceDecision();
    expect(sessionSourceDecisionSchema.safeParse({ ...decision, decision: "credit_not_recorded" }).success).toBe(false);
    expect(sessionSourceDecisionSchema.safeParse({ ...decision, authoredValue: "An authored title" }).success).toBe(
      false,
    );
    expect(
      sessionSourceDecisionSchema.safeParse({ ...decision, reviewedAt: "2023-03-04T01:00:00+01:00" }).success,
    ).toBe(false);
    expect(sessionHistoryMetadataSchema.safeParse({ sourceDecisions: Array(61).fill(decision) }).success).toBe(false);
    expect(
      sessionSourceDecisionSchema.parse({
        ...decision,
        kind: "credit",
        authoredValue: "TBC",
        decision: "credit_not_recorded",
        resolvedValue: null,
      }).authoredValue,
    ).toBe("TBC");
  });
  it("persists explicit missing-title decisions through export and refuses tampered embedded provenance", async () => {
    const value = input(),
      row = value.document.occurrences[0]!;
    row.fields.title = "Title not recorded";
    row.archive = sessionHistoryMetadataSchema.parse({ sourceDecisions: [sourceDecision()] });
    const review = await reviewAgendaTransfer(env.DB, eventId, "transfer-test", value);
    expect(review.ready).toBe(true);
    await expect(
      applyAgendaTransfer(
        env.DB,
        eventId,
        "transfer-test",
        {
          ...value,
          reviewDigest: review.digest,
          acknowledgeInferredTiming: true,
          acknowledgeArchiveRepresentation: false,
        },
        user,
      ),
    ).rejects.toMatchObject({ code: "AGENDA_TRANSFER_ARCHIVE_REVIEW_REQUIRED" });
    const applied = await applyAgendaTransfer(
      env.DB,
      eventId,
      "transfer-test",
      {
        ...value,
        reviewDigest: review.digest,
        acknowledgeInferredTiming: true,
        acknowledgeArchiveRepresentation: true,
      },
      user,
    );
    expect(applied.agenda.occurrences[0]!.history!.sourceDecisions).toEqual([sourceDecision()]);
    const document = await exportAgendaTransfer(
      env.DB,
      eventId,
      "transfer-test",
      agendaOccurrenceQuerySchema.parse({ limit: 100 }),
    );
    expect(document.occurrences[0]!.archive!.sourceDecisions[0]!.authoredValue).toBe(" ");
    const repeated = transferPrepareSchema.parse({ ...value, expectedRevision: applied.agenda.revision, document });
    expect((await reviewAgendaTransfer(env.DB, eventId, "transfer-test", repeated)).ready).toBe(true);
    for (const field of ["sourcePath", "sourceDigest"] as const) {
      const tampered = transferPrepareSchema.parse(repeated);
      tampered.document.occurrences[0]!.archive!.sourceDecisions[0]![field] =
        field === "sourcePath" ? "/events/elsewhere/" : "f".repeat(64);
      expect((await reviewAgendaTransfer(env.DB, eventId, "transfer-test", tampered)).ready).toBe(false);
    }
  });
  it.each([null, "proposal:accepted-source"])("exports a row without transfer provenance (%s)", async (sourceKey) => {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,source_key,start_at,end_at,recording_url) VALUES(?,?,?,?,?,?,?)",
    )
      .bind(
        id,
        eventId,
        "Locally scheduled",
        sourceKey,
        "2027-01-01T10:00:00.000Z",
        "2027-01-01T11:00:00.000Z",
        "https://example.test/local-recording",
      )
      .run();
    const exported = await exportAgendaTransfer(
      env.DB,
      eventId,
      "transfer-test",
      agendaOccurrenceQuerySchema.parse({ limit: 1 }),
    );
    expect(exported.occurrences[0]).toMatchObject({
      sourceKey: sourceKey ?? `portable:${eventId}:${id}`,
      timing: { startAt: "2027-01-01T10:00:00.000Z", endAt: "2027-01-01T11:00:00.000Z", endSource: "explicit" },
      media: [
        {
          kind: "recording",
          authoredReference: "https://example.test/local-recording",
          publicUrl: "https://example.test/local-recording",
          sourceDigest: null,
        },
      ],
    });
  });
  it("reconciles an exported archive with its original source and keeps copy-as-new distinct", async () => {
    const value = input();
    value.document.source.kind = "hugo";
    value.document.occurrences[0]!.sourceKey = "hugo:historical-event:opening";
    value.document.occurrences[0]!.timing.authoredDate = "2027-01-01";
    value.document.occurrences[0]!.timing.authoredStart = "10:00";
    const apply = async (prepared: ReturnType<typeof input>) => {
      const review = await reviewAgendaTransfer(env.DB, eventId, "transfer-test", prepared);
      expect(review.ready).toBe(true);
      expect(review.findings).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "anchor_collision" })]),
      );
      return applyAgendaTransfer(
        env.DB,
        eventId,
        "transfer-test",
        {
          ...prepared,
          reviewDigest: review.digest,
          acknowledgeInferredTiming: true,
          acknowledgeArchiveRepresentation: true,
        },
        user,
      );
    };
    const imported = await apply(value);
    const originalId = imported.agenda.occurrences[0]!.id;
    const originalProvenance = await env.DB.prepare(
      "SELECT source_format,source_ref,source_path,source_digest,timing_json FROM event_agenda_import_provenance WHERE occurrence_id=?",
    )
      .bind(originalId)
      .first();
    const exported = await exportAgendaTransfer(
      env.DB,
      eventId,
      "transfer-test",
      agendaOccurrenceQuerySchema.parse({ limit: 1 }),
    );
    expect(exported.occurrences[0]).toMatchObject({
      sourceKey: "hugo:historical-event:opening",
      sourceAnchor: "2026-talk",
      sourcePath: "/events/source/",
      timing: { authoredDate: "2027-01-01", authoredStart: "10:00" },
    });
    const reimport = transferPrepareSchema.parse({
      ...value,
      expectedRevision: imported.agenda.revision,
      document: exported,
    });
    const reconciled = await apply(reimport);
    expect(reconciled).toMatchObject({ imported: 0, skipped: 1 });
    expect(reconciled.agenda.occurrences.map((row) => row.id)).toEqual([originalId]);
    expect(
      await env.DB.prepare(
        "SELECT source_format,source_ref,source_path,source_digest,timing_json FROM event_agenda_import_provenance WHERE occurrence_id=?",
      )
        .bind(originalId)
        .first(),
    ).toEqual(originalProvenance);
    reimport.mode = "copy_as_new";
    reimport.expectedRevision = reconciled.agenda.revision;
    const copied = await apply(reimport);
    expect(copied.imported).toBe(1);
    expect(copied.agenda.occurrences).toHaveLength(2);
    const newOccurrence = copied.agenda.occurrences.find((row) => row.id !== originalId)!;
    expect(newOccurrence).toMatchObject({ startAt: null, endAt: null, roomId: null, visibility: "private" });
    expect(
      await env.DB.prepare("SELECT source_key FROM event_agenda_occurrences WHERE id=?").bind(newOccurrence.id).first(),
    ).toMatchObject({ source_key: `copy:${exported.source.sourceDigest}:${originalId}` });
  });
  it.each(["copy_as_new", "archive"] as const)(
    "keeps %s media reusable but requires fresh approval before public release",
    async (mode) => {
      const value = input();
      value.mode = mode;
      const url = "https://example.test/source-recording";
      value.document.occurrences[0]!.media = [
        {
          kind: "recording",
          authoredReference: "source-recording",
          publicUrl: url,
          sourceDigest: "b".repeat(64),
          bytes: null,
        },
      ];
      if (mode === "copy_as_new")
        value.document.occurrences[0]!.archive = sessionHistoryMetadataSchema.parse({
          sessionSlug: "old-session",
          legacyPaths: ["/events/old/session/"],
          prerequisites: "Background knowledge",
          archivalTiming: null,
          sourceDecisions: [],
          proposalRepresentations: [],
          archivalCredits: [],
          appearances: [
            {
              userId: user,
              actingIdentityId: null,
              displayName: "Historical Alex",
              jobTitle: "Old title",
              organizationName: "Old organization",
              biography: "Old biography",
              photoUrl: null,
              approvedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          materials: [
            {
              id: "old-material",
              kind: "recording",
              title: "Useful recording",
              url,
              presentationVersionId: null,
              presentationSource: "proposal",
              version: 1,
              rightsConfirmed: true,
              consentConfirmed: true,
              validated: true,
              status: "approved",
              approvedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      const review = await reviewAgendaTransfer(env.DB, eventId, "transfer-test", value);
      expect(review.ready).toBe(true);
      const imported = await applyAgendaTransfer(
        env.DB,
        eventId,
        "transfer-test",
        {
          ...value,
          reviewDigest: review.digest,
          acknowledgeInferredTiming: true,
          acknowledgeArchiveRepresentation: true,
        },
        user,
      );
      const occurrence = imported.agenda.occurrences[0]!;
      expect(occurrence.recordingUrl).toBeNull();
      expect(occurrence.history!.materials).toHaveLength(1);
      expect(occurrence.history!.materials[0]).toMatchObject({
        url,
        status: "draft",
        approvedAt: null,
        rightsConfirmed: false,
        consentConfirmed: false,
        validated: false,
      });
      if (mode === "copy_as_new") {
        expect(occurrence.history).toMatchObject({
          appearances: [],
          legacyPaths: [],
          sessionSlug: null,
          prerequisites: "Background knowledge",
        });
        expect(occurrence.history!.materials[0]!.id).not.toBe("old-material");
      }
      const scheduled = await patchAgendaOccurrence(
        env.DB,
        eventId,
        "transfer-test",
        occurrence.id,
        {
          expectedRevision: imported.agenda.revision,
          startAt: "2027-01-01T10:00:00.000Z",
          endAt: "2027-01-01T11:00:00.000Z",
          roomId: room,
          additionalRoomIds: [],
          visibility: "public",
        },
        user,
      );
      const publicationAppearances = [
        individualAppearanceFixture({
          userId: user,
          displayName: mode === "copy_as_new" ? "New session individual credit" : "Reviewed archive individual credit",
          approvedAt: "2026-10-04T10:00:00.000Z",
        }),
      ];
      await seedApprovedSessionAppearances(env.DB, {
        occurrenceId: occurrence.id,
        reviewerId: user,
        appearances: publicationAppearances,
      });
      await publishAgenda(env.DB, eventId, "transfer-test", scheduled.revision, user);
      const published = async () => {
        const row = await env.DB.prepare(
          "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=? ORDER BY revision DESC LIMIT 1",
        )
          .bind(eventId)
          .first<{ snapshot_json: string }>();
        return projectLiveAgendaMaterials(env.DB, eventId, agendaSnapshotSchema.parse(JSON.parse(row!.snapshot_json)));
      };
      expect((await published()).occurrences[0]).toMatchObject({ recordingUrl: null, history: { materials: [] } });
      const approved = await saveSessionHistory(
        env.DB,
        eventId,
        "transfer-test",
        occurrence.id,
        scheduled.revision + 1,
        {
          ...occurrence.history!,
          appearances: publicationAppearances,
          materials: occurrence.history!.materials.map((material) => ({
            ...material,
            rightsConfirmed: true,
            consentConfirmed: true,
            validated: true,
            status: "approved",
            approvedAt: "2026-10-04T10:00:00.000Z",
          })),
        },
        user,
      );
      await publishAgenda(env.DB, eventId, "transfer-test", approved.revision, user);
      expect((await published()).occurrences[0]).toMatchObject({
        recordingUrl: url,
        history: { materials: [expect.objectContaining({ url, status: "approved" })] },
      });
      const provenance = await env.DB.prepare(
        "SELECT media_json FROM event_agenda_import_provenance WHERE occurrence_id=?",
      )
        .bind(occurrence.id)
        .first<{ media_json: string }>();
      expect(JSON.parse(provenance!.media_json)[0]).toMatchObject({
        authoredReference: "source-recording",
        sourceDigest: "b".repeat(64),
      });
    },
  );

  it("honors an explicit unaffiliated identity resolution instead of restoring an invalid source identity", async () => {
    const value = input();
    value.document.people[0]!.actingIdentityId = crypto.randomUUID();
    expect((await reviewAgendaTransfer(env.DB, eventId, "transfer-test", value)).ready).toBe(false);
    value.resolutions.people.speaker = { userId: user, actingIdentityId: null };
    const review = await reviewAgendaTransfer(env.DB, eventId, "transfer-test", value);
    expect(review.ready).toBe(true);
    await applyAgendaTransfer(
      env.DB,
      eventId,
      "transfer-test",
      {
        ...value,
        reviewDigest: review.digest,
        acknowledgeInferredTiming: true,
        acknowledgeArchiveRepresentation: true,
      },
      user,
    );
    const stored = await env.DB.prepare("SELECT people_json FROM event_agenda_import_provenance").first<{
      people_json: string;
    }>();
    expect(JSON.parse(stored!.people_json)).toEqual([{ sourceRef: "speaker", userId: user, actingIdentityId: null }]);
  });
  it("exports current edited dates and media while retaining authored provenance", async () => {
    const value = input();
    value.document.occurrences[0]!.media = [
      {
        kind: "recording",
        authoredReference: "legacy-recording",
        publicUrl: "https://example.test/old-recording",
        sourceDigest: "b".repeat(64),
        bytes: null,
      },
    ];
    const review = await reviewAgendaTransfer(env.DB, eventId, "transfer-test", value);
    await applyAgendaTransfer(
      env.DB,
      eventId,
      "transfer-test",
      {
        ...value,
        reviewDigest: review.digest,
        acknowledgeInferredTiming: true,
        acknowledgeArchiveRepresentation: true,
      },
      user,
    );
    await env.DB.prepare("UPDATE event_agenda_occurrences SET start_at=?,end_at=?,recording_url=? WHERE event_id=?")
      .bind("2027-01-02T12:00:00.000Z", "2027-01-02T13:00:00.000Z", "https://example.test/revised-recording", eventId)
      .run();
    const exported = await exportAgendaTransfer(
      env.DB,
      eventId,
      "transfer-test",
      agendaOccurrenceQuerySchema.parse({ limit: 1 }),
    );
    expect(exported.occurrences[0]!.timing).toMatchObject({
      startAt: "2027-01-02T12:00:00.000Z",
      endAt: "2027-01-02T13:00:00.000Z",
    });
    expect(exported.occurrences[0]!.media).toEqual([
      {
        kind: "recording",
        authoredReference: "legacy-recording",
        publicUrl: "https://example.test/revised-recording",
        sourceDigest: null,
        bytes: null,
      },
    ]);
    const stored = await env.DB.prepare("SELECT timing_json,media_json FROM event_agenda_import_provenance").first<{
      timing_json: string;
      media_json: string;
    }>();
    expect(JSON.parse(stored!.timing_json).startAt).toBe("2027-01-01T10:00:00.000Z");
    expect(JSON.parse(stored!.media_json)[0].publicUrl).toBe("https://example.test/old-recording");
  });

  it("guards mounted organizer prepare, export and apply endpoints", async () => {
    const token = await createAdminSession(env.DB, user, "transfer-route");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const response = await callApi(env, "/api/v1/events/transfer-test/agenda/transfers/reviews", {
      method: "POST",
      headers,
      body: JSON.stringify(input()),
    });
    expect(response.status).toBe(200);
    const reviewed = (await response.json()) as { digest: string; ready: boolean };
    expect(reviewed.ready).toBe(true);
    const apply = await callApi(env, "/api/v1/events/transfer-test/agenda/transfers", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...input(),
        reviewDigest: reviewed.digest,
        acknowledgeInferredTiming: true,
        acknowledgeArchiveRepresentation: true,
      }),
    });
    expect(apply.status).toBe(200);
    expect(
      (await callApi(env, "/api/v1/events/transfer-test/agenda/transfers/exports?limit=1", { headers })).status,
    ).toBe(200);
    expect(
      (
        await callApi(env, "/api/v1/events/transfer-test/agenda/transfers/reviews", {
          method: "POST",
          body: JSON.stringify(input()),
        })
      ).status,
    ).toBe(401);
  });

  it("applies multiroom anchor and provenance atomically, exports roundtrip and stays unpublished", async () => {
    const value = input(),
      review = await reviewAgendaTransfer(env.DB, eventId, "transfer-test", value);
    expect(review.ready).toBe(true);
    const result = await applyAgendaTransfer(
      env.DB,
      eventId,
      "transfer-test",
      {
        ...value,
        reviewDigest: review.digest,
        acknowledgeInferredTiming: true,
        acknowledgeArchiveRepresentation: true,
      },
      user,
    );
    expect(result.imported).toBe(1);
    expect(result.agenda.publishedRevision).toBeNull();
    expect(result.agenda.occurrences[0]).toMatchObject({
      publicAnchor: "2026-talk",
      roomId: room,
      additionalRoomIds: [room2],
      speakers: [expect.objectContaining({ userId: user, role: "moderator" })],
    });
    expect(
      await env.DB.prepare("SELECT source_ref,source_anchor FROM event_agenda_import_provenance").first(),
    ).toMatchObject({ source_ref: "talk", source_anchor: "2026-talk" });
    const exported = await exportAgendaTransfer(
      env.DB,
      eventId,
      "transfer-test",
      agendaOccurrenceQuerySchema.parse({ limit: 1 }),
    );
    expect(exported.page).toMatchObject({ total: 1, hasMore: false });
    expect(exported.occurrences[0]).toMatchObject({ sourceAnchor: "2026-talk", roomRefs: [room, room2] });
  });
  it("blocks unresolved identities and altered review digest without allocating any rows", async () => {
    const value = input();
    value.document.people[0]!.canonicalUserId = null;
    expect(await reviewAgendaTransfer(env.DB, eventId, "transfer-test", value)).toMatchObject({
      ready: false,
      findings: [expect.objectContaining({ code: "person_unresolved" })],
    });
    value.resolutions.people.speaker = { userId: user, actingIdentityId: null };
    const review = await reviewAgendaTransfer(env.DB, eventId, "transfer-test", value);
    await expect(
      applyAgendaTransfer(
        env.DB,
        eventId,
        "transfer-test",
        {
          ...value,
          reviewDigest: "f".repeat(64),
          acknowledgeInferredTiming: true,
          acknowledgeArchiveRepresentation: true,
        },
        user,
      ),
    ).rejects.toMatchObject({ code: "AGENDA_TRANSFER_REVIEW_REQUIRED" });
    expect(review.ready).toBe(true);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_occurrences").first()).toMatchObject({
      count: 0,
    });
  });
  it("preserves organizer edits when the same source changes and records source review", async () => {
    const value = input(),
      review = await reviewAgendaTransfer(env.DB, eventId, "transfer-test", value);
    await applyAgendaTransfer(
      env.DB,
      eventId,
      "transfer-test",
      {
        ...value,
        reviewDigest: review.digest,
        acknowledgeInferredTiming: true,
        acknowledgeArchiveRepresentation: true,
      },
      user,
    );
    await env.DB.prepare("UPDATE event_agenda_occurrences SET title='Organizer edit'").run();
    value.expectedRevision = 1;
    value.document.occurrences[0]!.sourceAnchor = null;
    value.document.occurrences[0]!.fields.title = "New source text";
    const updated = await reviewAgendaTransfer(env.DB, eventId, "transfer-test", value);
    expect(updated.ready).toBe(true);
    expect(updated.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "local_edits" })]));
    const result = await applyAgendaTransfer(
      env.DB,
      eventId,
      "transfer-test",
      {
        ...value,
        reviewDigest: updated.digest,
        acknowledgeInferredTiming: true,
        acknowledgeArchiveRepresentation: true,
      },
      user,
    );
    expect(result.imported).toBe(0);
    expect(result.agenda.occurrences[0]!.title).toBe("Organizer edit");
  });
});

it("preserves past source-only credits without creating canonical speakers and refuses future provenance", async () => {
  const value = input();
  value.document.people[0]!.canonicalUserId = null;
  const row = value.document.occurrences[0]!;
  row.timing.startAt = "2023-03-03T14:00:00.000Z";
  row.timing.endAt = "2023-03-03T14:30:00.000Z";
  row.archive = sessionHistoryMetadataSchema.parse({
    appearances: [],
    archivalTiming: null,
    sourceDecisions: [],
    proposalRepresentations: [],
    archivalCredits: [
      {
        sourceRef: "speaker",
        role: "moderator",
        sourcePath: row.sourcePath,
        sourceDigest: value.document.source.sourceDigest,
        provenance: "authored_public",
        displayName: "Alex",
        jobTitle: "Historical role",
        organizationName: null,
        biography: "Original biography",
        photoUrl: null,
      },
    ],
    materials: [],
    legacyPaths: [],
    sessionSlug: null,
    prerequisites: "",
  });
  const review = await reviewAgendaTransfer(env.DB, eventId, "transfer-test", value);
  expect(review.ready).toBe(true);
  expect(review.findings).toContainEqual(
    expect.objectContaining({ code: "historical_credit_unlinked", severity: "information" }),
  );
  const applied = await applyAgendaTransfer(
    env.DB,
    eventId,
    "transfer-test",
    {
      ...value,
      reviewDigest: review.digest,
      acknowledgeInferredTiming: true,
      acknowledgeArchiveRepresentation: true,
    },
    user,
  );
  expect(applied.agenda.occurrences[0]!.speakers).toEqual([]);
  await expect(publishAgenda(env.DB, eventId, "transfer-test", applied.agenda.revision, user)).rejects.toMatchObject({
    code: "AGENDA_HISTORICAL_MAPPING_REQUIRED",
  });
  expect(applied.agenda.occurrences[0]!.history?.archivalCredits[0]).toMatchObject({
    displayName: "Alex",
    sourceRef: "speaker",
    role: "moderator",
  });
  const exported = await exportAgendaTransfer(
    env.DB,
    eventId,
    "transfer-test",
    agendaOccurrenceQuerySchema.parse({ limit: 100 }),
  );
  expect(exported.people[0]!.canonicalUserId).toBeNull();
  expect(exported.occurrences[0]!.archive!.archivalCredits[0]).toEqual(row.archive.archivalCredits[0]);
  const roundTrip = transferPrepareSchema.parse({
    ...value,
    expectedRevision: applied.agenda.revision,
    document: exported,
  });
  const repeatedReview = await reviewAgendaTransfer(env.DB, eventId, "transfer-test", roundTrip);
  expect(repeatedReview.ready).toBe(true);
  const repeated = await applyAgendaTransfer(
    env.DB,
    eventId,
    "transfer-test",
    {
      ...roundTrip,
      reviewDigest: repeatedReview.digest,
      acknowledgeInferredTiming: true,
      acknowledgeArchiveRepresentation: true,
    },
    user,
  );
  expect(repeated.agenda.occurrences.map((item) => item.id)).toEqual(applied.agenda.occurrences.map((item) => item.id));
  const tampered = transferPrepareSchema.parse({ ...roundTrip, expectedRevision: repeated.agenda.revision });
  tampered.document.occurrences[0]!.archive!.archivalCredits[0]!.sourceDigest = "c".repeat(64);
  expect((await reviewAgendaTransfer(env.DB, eventId, "transfer-test", tampered)).ready).toBe(false);
  const users = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  expect(users!.count).toBe(1);
  value.expectedRevision = repeated.agenda.revision;
  row.sourceKey = "portable:future-credit";
  row.timing.startAt = "2099-01-01T10:00:00.000Z";
  row.timing.endAt = "2099-01-01T11:00:00.000Z";
  expect((await reviewAgendaTransfer(env.DB, eventId, "transfer-test", value)).ready).toBe(false);
});

it("archives an unknown historical end without allocating a fabricated scheduled interval", async () => {
  const value = input();
  value.document.people = [];
  const row = value.document.occurrences[0]!;
  row.personRefs = [];
  row.timing.startAt = "2023-03-03T20:30:00.000Z";
  row.timing.endAt = null;
  row.timing.endSource = "unresolved";
  row.archive = sessionHistoryMetadataSchema.parse({
    appearances: [],
    archivalCredits: [],
    materials: [],
    legacyPaths: [],
    prerequisites: "",
    sessionSlug: null,
    sourceDecisions: [],
    proposalRepresentations: [],
    archivalTiming: {
      sourcePath: row.sourcePath,
      sourceDigest: value.document.source.sourceDigest,
      provenance: "authored_public",
      timeZone: row.timing.timeZone,
      authoredDate: row.timing.authoredDate,
      authoredStart: row.timing.authoredStart,
      startAt: row.timing.startAt,
      endAt: null,
    },
  });
  const review = await reviewAgendaTransfer(env.DB, eventId, "transfer-test", value);
  expect(review.ready).toBe(true);
  const applied = await applyAgendaTransfer(
    env.DB,
    eventId,
    "transfer-test",
    { ...value, reviewDigest: review.digest, acknowledgeInferredTiming: true, acknowledgeArchiveRepresentation: true },
    user,
  );
  const occurrence = applied.agenda.occurrences[0]!;
  expect(occurrence.startAt).toBeNull();
  expect(occurrence.endAt).toBeNull();
  expect(occurrence.history!.archivalTiming!.startAt).toBe(row.timing.startAt);
  expect(occurrence.history!.archivalTiming!.endAt).toBeNull();
  const exported = await exportAgendaTransfer(
    env.DB,
    eventId,
    "transfer-test",
    agendaOccurrenceQuerySchema.parse({ limit: 100 }),
  );
  expect(exported.occurrences[0]!.timing.startAt).toBe(row.timing.startAt);
  expect(exported.occurrences[0]!.timing.endAt).toBeNull();
  expect(exported.occurrences[0]!.archive!.archivalTiming).toEqual(row.archive.archivalTiming);
  expect(
    (
      await reviewAgendaTransfer(
        env.DB,
        eventId,
        "transfer-test",
        transferPrepareSchema.parse({ ...value, expectedRevision: applied.agenda.revision, document: exported }),
      )
    ).ready,
  ).toBe(true);
  value.expectedRevision = applied.agenda.revision;
  row.sourceKey = "portable:future-unknown-end";
  row.timing.startAt = "2099-01-01T10:00:00.000Z";
  row.archive.archivalTiming!.startAt = row.timing.startAt;
  expect((await reviewAgendaTransfer(env.DB, eventId, "transfer-test", value)).ready).toBe(false);
});
