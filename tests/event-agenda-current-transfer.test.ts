import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { agendaPublicationSchema, agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import { apiErrorPayloadSchema } from "../assets/shared/schemas/api-common";
import {
  transferApplySchema,
  transferApplyResponseSchema,
  transferPrepareSchema,
  transferReviewSchema,
  type AgendaTransferMode,
} from "../assets/shared/schemas/event-agenda-transfer";
import { sessionHistoryMetadataSchema } from "../assets/shared/schemas/event-session-history";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { individualAppearanceFixture } from "./helpers/agenda-appearances";
import { resetDb } from "./helpers/reset-db";

const sourcePath = "content/events/2026/pqc-conference-amsterdam-nl/_index.md";
const sourceDigest = "c".repeat(64);
const approvedAt = "2026-10-01T09:00:00.000Z";
const mainRoom = crypto.randomUUID(),
  extraRoom = crypto.randomUUID();

async function fixture() {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  await env.DB.prepare("UPDATE events SET visibility='public' WHERE id=?").bind(eventId).run();
  for (const [id, name] of [
    [mainRoom, "Main hall"],
    [extraRoom, "Overflow"],
  ])
    await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,?,200)")
      .bind(id, eventId, name)
      .run();
  const token = await createAdminSession(env.DB, admin.id, "current-agenda-transfer");
  const request = (path: string, body: unknown) =>
    callApi(env, `/api/v1/events/pqc-2026/agenda${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { eventId, actor: admin.id, request };
}

/** A synthetic authored Hugo program for an upcoming event with a mapped, approved speaker. */
function program(actor: string, mode: AgendaTransferMode = "current") {
  return transferPrepareSchema.parse({
    expectedRevision: 0,
    mode,
    resolutions: { people: {}, rooms: {}, media: {}, rows: {} },
    document: {
      format: "pkic-agenda",
      version: 1,
      source: { kind: "hugo", eventRef: "pqc-2026", exportedAt: approvedAt, sourceDigest },
      people: [
        { ref: "Alex Speaker", label: "Alex Speaker", canonicalUserId: actor, actingIdentityId: null, role: "speaker" },
      ],
      rooms: [
        { ref: "main", label: "Main hall", canonicalRoomId: mainRoom },
        { ref: "overflow", label: "Overflow", canonicalRoomId: extraRoom },
      ],
      occurrences: [
        {
          ref: "2026-12-01:0:0",
          sourceKey: "legacy:pqc-2026:opening",
          sourceAnchor: "opening-keynote",
          sourcePath,
          fields: {
            title: "Opening keynote",
            description: "Authored abstract",
            visibility: "public",
            kind: "session",
            admissionPolicy: "preference",
            capacity: 150,
          },
          timing: {
            timeZone: "Europe/Amsterdam",
            authoredDate: "2026-12-01",
            authoredStart: "10:00",
            startAt: "2026-12-01T09:00:00.000Z",
            endAt: "2026-12-01T09:45:00.000Z",
            endSource: "explicit",
            transitionMinutes: 0,
            transitionSource: "none",
          },
          roomRefs: ["main"],
          personRefs: ["Alex Speaker"],
          media: [],
          archive: sessionHistoryMetadataSchema.parse({
            appearances: [individualAppearanceFixture({ userId: actor, displayName: "Alex Speaker", approvedAt })],
          }),
        },
        {
          ref: "2026-12-01:1:0",
          sourceKey: "legacy:pqc-2026:coffee",
          sourceAnchor: "coffee-break",
          sourcePath,
          fields: { title: "Coffee break", description: "", visibility: "public", kind: "break" },
          timing: {
            timeZone: "Europe/Amsterdam",
            authoredDate: "2026-12-01",
            authoredStart: "10:45",
            startAt: "2026-12-01T09:45:00.000Z",
            endAt: "2026-12-01T10:15:00.000Z",
            endSource: "duration",
            transitionMinutes: 0,
            transitionSource: "none",
          },
          roomRefs: ["main", "overflow"],
          personRefs: [],
          media: [],
          archive: null,
        },
      ],
    },
  });
}

async function review(context: Awaited<ReturnType<typeof fixture>>, value: ReturnType<typeof program>) {
  const response = await context.request("/transfers/reviews", value);
  expect(response.status, await response.clone().text()).toBe(200);
  return transferReviewSchema.parse(await response.json());
}

async function apply(context: Awaited<ReturnType<typeof fixture>>, value: ReturnType<typeof program>) {
  const reviewed = await review(context, value);
  expect(reviewed.ready, JSON.stringify(reviewed.findings)).toBe(true);
  const response = await context.request(
    "/transfers",
    transferApplySchema.parse({
      ...value,
      reviewDigest: reviewed.digest,
      acknowledgeInferredTiming: true,
      acknowledgeArchiveRepresentation: true,
    }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return transferApplyResponseSchema.parse(await response.json());
}

async function agendaState() {
  return Promise.all(
    [
      "SELECT event_id,revision,published_revision FROM event_agenda_state ORDER BY event_id",
      "SELECT id,source_key,start_at,end_at,room_id,visibility,public_anchor FROM event_agenda_occurrences ORDER BY id",
      "SELECT occurrence_id,room_id FROM event_agenda_occurrence_rooms ORDER BY occurrence_id,room_id",
      "SELECT occurrence_id,user_id FROM event_agenda_occurrence_speakers ORDER BY occurrence_id,user_id",
      "SELECT occurrence_id,metadata_json FROM event_agenda_session_history ORDER BY occurrence_id",
      "SELECT occurrence_id,import_mode,source_format,people_json,imported_at FROM event_agenda_import_provenance ORDER BY occurrence_id",
      "SELECT id,source_key,source_review_json FROM event_agenda_contents ORDER BY id",
    ].map((sql) => queryAll(env.DB, sql)),
  );
}

describe("current agenda transfer for an upcoming authored program", () => {
  beforeEach(resetDb);

  it("keeps times, locations and public visibility and approves as ordinary authored sessions", async () => {
    const context = await fixture();
    const value = program(context.actor);
    const reviewed = await review(context, value);
    expect(reviewed.findings).toEqual([
      expect.objectContaining({ rowRef: "2026-12-01:1:0", code: "timing_inferred", severity: "review" }),
    ]);
    const result = await apply(context, value);
    expect(result.imported).toBe(2);
    const keynote = result.agenda.occurrences.find((item) => item.title === "Opening keynote")!;
    expect(keynote).toMatchObject({
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T09:45:00.000Z",
      roomId: mainRoom,
      visibility: "public",
      capacity: 150,
      publicAnchor: "opening-keynote",
    });
    expect(result.agenda.occurrences.find((item) => item.title === "Coffee break")).toMatchObject({
      startAt: "2026-12-01T09:45:00.000Z",
      endAt: "2026-12-01T10:15:00.000Z",
      roomId: mainRoom,
      additionalRoomIds: [extraRoom],
      visibility: "public",
    });
    expect(keynote.speakers.map((speaker) => speaker.userId)).toEqual([context.actor]);
    expect(keynote.history).toMatchObject({ archivalCredits: [], archivalTiming: null, sourceDecisions: [] });
    expect(keynote.history!.appearances).toEqual(value.document.occurrences[0]!.archive!.appearances);
    expect(
      await queryAll(env.DB, "SELECT DISTINCT import_mode,source_format FROM event_agenda_import_provenance"),
    ).toEqual([{ import_mode: "current", source_format: "hugo" }]);

    const published = await context.request(
      "/publications",
      agendaPublicationSchema.parse({ expectedRevision: result.agenda.revision }),
    );
    expect(published.status, await published.clone().text()).toBe(200);
    const snapshot = agendaSnapshotSchema.parse(await published.json());
    expect(snapshot.publishedRevision).toBe(snapshot.revision);
  });

  it("blocks unresolved people, source-only credits, not-recorded decisions and unknown ends", async () => {
    const context = await fixture();
    const value = program(context.actor);
    value.document.people.push({
      ref: "Unmapped Speaker",
      label: "Unmapped Speaker",
      canonicalUserId: null,
      actingIdentityId: null,
      role: "speaker",
    });
    const keynote = value.document.occurrences[0]!;
    keynote.personRefs.push("Unmapped Speaker");
    keynote.archive!.archivalCredits = [
      {
        sourceRef: "Unmapped Speaker",
        role: "speaker",
        sourcePath,
        sourceDigest,
        provenance: "authored_public",
        displayName: "Unmapped Speaker",
        jobTitle: null,
        organizationName: null,
        biography: "",
        photoUrl: null,
      },
    ];
    keynote.archive!.sourceDecisions = [
      {
        kind: "credit",
        sourcePath,
        sourceDigest,
        sourceLocator: keynote.ref,
        authoredValue: "TBC",
        decision: "credit_not_recorded",
        resolvedValue: null,
        reviewedAt: approvedAt,
      },
    ];
    const coffee = value.document.occurrences[1]!;
    coffee.timing.endAt = null;
    coffee.timing.endSource = "unresolved";
    const before = await agendaState();
    const reviewed = await review(context, value);
    expect(reviewed.ready).toBe(false);
    expect(reviewed.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rowRef: keynote.ref, code: "person_unresolved", severity: "blocking" }),
        expect.objectContaining({ rowRef: keynote.ref, code: "historical_credit_unlinked", severity: "blocking" }),
        expect.objectContaining({ rowRef: keynote.ref, code: "source_not_recorded", severity: "blocking" }),
        expect.objectContaining({ rowRef: coffee.ref, code: "timing_unresolved", severity: "blocking" }),
      ]),
    );
    expect(reviewed.findings.some((finding) => finding.severity === "information")).toBe(false);
    const refused = await context.request(
      "/transfers",
      transferApplySchema.parse({
        ...value,
        reviewDigest: reviewed.digest,
        acknowledgeInferredTiming: true,
        acknowledgeArchiveRepresentation: true,
      }),
    );
    expect(refused.status).toBe(409);
    expect(apiErrorPayloadSchema.parse(await refused.json()).error.code).toBe("AGENDA_TRANSFER_REVIEW_REQUIRED");
    expect(await agendaState()).toEqual(before);
  });

  it("replays the same current import without changes", async () => {
    const context = await fixture();
    const first = await apply(context, program(context.actor));
    const after = await agendaState();
    const replay = program(context.actor);
    replay.expectedRevision = first.agenda.revision;
    const reviewed = await review(context, replay);
    expect(reviewed.findings.filter((finding) => finding.code !== "timing_inferred")).toEqual([]);
    expect(reviewed).toMatchObject({ imported: 0, skipped: 2 });
    const second = await apply(context, replay);
    expect(second).toMatchObject({ imported: 0, skipped: 2, reviewRequired: 0 });
    expect(second.agenda.revision).toBe(first.agenda.revision);
    expect(await agendaState()).toEqual(after);
  });

  it("still refuses to approve an archive import of a future authored program", async () => {
    const context = await fixture();
    const result = await apply(context, program(context.actor, "archive"));
    const before = await agendaState();
    const refused = await context.request(
      "/publications",
      agendaPublicationSchema.parse({
        expectedRevision: result.agenda.revision,
        acknowledgeArchiveRepresentation: true,
      }),
    );
    expect(refused.status).toBe(422);
    expect(apiErrorPayloadSchema.parse(await refused.json()).error.code).toBe("AGENDA_HISTORICAL_MAPPING_REQUIRED");
    expect(await agendaState()).toEqual(before);
  });
});
