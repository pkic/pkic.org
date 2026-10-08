import { grantAdministrator } from "./helpers/administrator";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { agendaOccurrenceQuerySchema, agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import {
  transferPrepareSchema,
  transferReviewSchema,
  transferApplyResponseSchema,
  agendaTransferSchema,
} from "../assets/shared/schemas/event-agenda-transfer";
import { sessionHistoryMetadataSchema } from "../assets/shared/schemas/event-session-history";
import { exportAgendaTransfer } from "../functions/_lib/services/event-agenda/transfer";
import { agendaContent } from "../assets/shared/public-agenda-content";
import { publicAgendaProjection } from "../functions/_lib/services/event-agenda/public-projection";

const actor = crypto.randomUUID(),
  eventId = crypto.randomUUID(),
  roomId = crypto.randomUUID();
const slug = "legacy-links",
  sourcePath = "/events/original/",
  sourceDigest = "a".repeat(64),
  clock = "2023-04-02T00:00:00.000Z";
let token = "";
function request(eventSlug: string, path: string, body: unknown, method = "POST") {
  return callApi(env, `/api/v1/events/${eventSlug}/agenda${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function input() {
  return transferPrepareSchema.parse({
    expectedRevision: 0,
    mode: "archive",
    resolutions: { people: {}, rooms: {}, media: {}, rows: {} },
    document: {
      format: "pkic-agenda",
      version: 1,
      source: { kind: "hugo", eventRef: slug, exportedAt: clock, sourceDigest },
      people: [],
      rooms: [{ ref: "Authored room", label: "Original room", canonicalRoomId: roomId }],
      occurrences: [
        {
          ref: "original-row",
          sourceKey: "legacy:links:row",
          sourcePath,
          sourceDigest,
          sourceAnchor: null,
          fields: { title: "Historical break", kind: "break", visibility: "public" },
          roomRefs: ["Authored room"],
          personRefs: [],
          media: [],
          timing: {
            timeZone: "UTC",
            authoredDate: "2023-04-01",
            authoredStart: "8:30",
            startAt: "2023-04-01T08:30:00.000Z",
            endAt: "2023-04-01T09:00:00.000Z",
            endSource: "explicit",
            transitionMinutes: 0,
            transitionSource: "none",
          },
          archive: sessionHistoryMetadataSchema.parse({
            legacyFragments: [
              {
                anchor: "sessionModal-830-0-hw/fw",
                kind: "dialog",
                roomRef: "Authored room",
                roomId,
                sourcePath,
                sourceDigest,
                sourceLocator: "original-row",
                authoredDate: "2023-04-01",
                authoredStart: "8:30",
                authoredTitle: "HW/FW",
              },
            ],
          }),
        },
      ],
    },
  });
}
async function apply(eventSlug: string, value: ReturnType<typeof input>) {
  const checked = await request(eventSlug, "/transfers/reviews", value);
  expect(checked.status, await checked.clone().text()).toBe(200);
  const review = transferReviewSchema.parse(await checked.json());
  expect(review.ready, JSON.stringify(review.findings)).toBe(true);
  const result = await request(eventSlug, "/transfers", {
    ...value,
    reviewDigest: review.digest,
    acknowledgeInferredTiming: true,
    acknowledgeArchiveRepresentation: true,
  });
  expect(result.status, await result.clone().text()).toBe(200);
  return transferApplyResponseSchema.parse(await result.json());
}
async function seedEvent(id: string, eventSlug: string, room: string) {
  await env.DB.prepare(
    "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,?,?,'UTC','{}',?,?)",
  )
    .bind(id, eventSlug, eventSlug, clock, clock)
    .run();
  await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,?,20)")
    .bind(room, id, "Current room name")
    .run();
}
async function exportedDocument(eventSlug: string) {
  const response = await callApi(env, `/api/v1/events/${eventSlug}/agenda/transfers/exports?limit=100`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return agendaTransferSchema.parse(await response.json());
}
async function savedHistory(agenda: ReturnType<typeof agendaSnapshotSchema.parse>, materials: unknown[]) {
  const occurrence = agenda.occurrences[0]!;
  const response = await request(slug, `/occurrences/${occurrence.id}/history`, {
    expectedRevision: agenda.revision,
    history: { ...occurrence.history, materials },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return agendaSnapshotSchema.parse(await response.json());
}
async function movedAgenda(agenda: ReturnType<typeof agendaSnapshotSchema.parse>, nextRoom: string | null) {
  const response = await request(
    slug,
    `/occurrences/${agenda.occurrences[0]!.id}`,
    { expectedRevision: agenda.revision, roomId: nextRoom, title: "Edited break" },
    "PATCH",
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return agendaSnapshotSchema.parse(await response.json());
}
beforeEach(async () => {
  await resetDb();
  await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
    .bind(actor, "links@example.test", "links@example.test")
    .run();
  await grantAdministrator(env.DB, actor);
  await seedEvent(eventId, slug, roomId);
  token = await createAdminSession(env.DB, actor, crypto.randomUUID());
});
describe("protected historical link import", () => {
  it("retains unassigned session aliases without adding room reservations and requires owned fresh archive mapping", async () => {
    const value = input(),
      cleared = await movedAgenda((await apply(slug, value)).agenda, null),
      occurrence = cleared.occurrences[0]!;
    expect(occurrence).toMatchObject({ roomId: null, additionalRoomIds: [], visibility: "public" });
    expect(occurrence.history!.legacyFragments).toEqual(value.document.occurrences[0]!.archive!.legacyFragments);
    expect(agendaContent(publicAgendaProjection(cleared, null)).days[0]!.slots[0]!.sessions[0]).toMatchObject({
      locations: [],
      legacyFragments: [{ anchor: "sessionModal-830-0-hw/fw", kind: "dialog", roomId: null }],
    });
    const document = await exportedDocument(slug);
    expect(document.occurrences[0]!.roomRefs).toEqual([]);
    const sameEvent = transferPrepareSchema.parse({ ...value, document, expectedRevision: cleared.revision });
    const retained = (await apply(slug, sameEvent)).agenda.occurrences[0]!;
    expect(retained).toMatchObject({ roomId: null, additionalRoomIds: [] });
    expect(retained.history!.legacyFragments).toEqual(occurrence.history!.legacyFragments);

    const targetSlug = "unassigned-link-target",
      targetRoom = crypto.randomUUID(),
      foreignRoom = crypto.randomUUID();
    await seedEvent(crypto.randomUUID(), targetSlug, targetRoom);
    await seedEvent(crypto.randomUUID(), "foreign-history-room", foreignRoom);
    const fresh = transferPrepareSchema.parse({ ...value, document });
    for (const rooms of [{}, { [roomId]: foreignRoom }]) {
      fresh.resolutions.rooms = rooms;
      const response = await request(targetSlug, "/transfers/reviews", fresh);
      expect(response.status, await response.clone().text()).toBe(200);
      const review = transferReviewSchema.parse(await response.json());
      expect(review.ready).toBe(false);
      expect(review.findings).toContainEqual(expect.objectContaining({ field: "archive", code: "invalid_reference" }));
    }
    fresh.resolutions.rooms = { [roomId]: targetRoom };
    const importedAgenda = (await apply(targetSlug, fresh)).agenda,
      imported = importedAgenda.occurrences[0]!;
    expect(imported).toMatchObject({ roomId: null, additionalRoomIds: [] });
    expect(imported.history!.legacyFragments[0]).toEqual({
      ...occurrence.history!.legacyFragments[0],
      roomId: targetRoom,
    });
    expect(
      agendaContent(publicAgendaProjection(importedAgenda, null)).days[0]!.slots[0]!.sessions[0]!.legacyFragments,
    ).toEqual([{ anchor: "sessionModal-830-0-hw/fw", kind: "dialog", roomId: null }]);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_occurrence_rooms WHERE occurrence_id IN(?,?)")
        .bind(occurrence.id, imported.id)
        .first<{ count: number }>())!.count,
    ).toBe(0);
  });
  it("keeps a moved session's authored alias on its owning occurrence and explicitly maps it in a fresh archive", async () => {
    const nextRoom = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,?,20)")
      .bind(nextRoom, eventId, "Moved room")
      .run();
    const result = await apply(slug, input()),
      occurrence = result.agenda.occurrences[0]!;
    const moved = await movedAgenda(result.agenda, nextRoom);
    expect(moved.occurrences[0]!.history!.legacyFragments).toEqual(occurrence.history!.legacyFragments);
    expect(agendaContent(publicAgendaProjection(moved, null)).days[0]!.slots[0]!.sessions[0]!.legacyFragments).toEqual([
      { anchor: "sessionModal-830-0-hw/fw", kind: "dialog", roomId: nextRoom },
    ]);
    const document = await exportedDocument(slug);
    expect(document.occurrences[0]!.roomRefs).toEqual([nextRoom]);
    expect(document.occurrences[0]!.archive!.legacyFragments[0]).toEqual(occurrence.history!.legacyFragments[0]);
    const sameEvent = transferPrepareSchema.parse({
      ...input(),
      document,
      expectedRevision: moved.revision,
    });
    const sameReview = transferReviewSchema.parse(await (await request(slug, "/transfers/reviews", sameEvent)).json());
    expect(sameReview.ready, JSON.stringify(sameReview.findings)).toBe(true);
    const altered = structuredClone(sameEvent);
    altered.document.occurrences[0]!.archive!.legacyFragments[0]!.authoredTitle = "Forged original";
    expect(transferReviewSchema.parse(await (await request(slug, "/transfers/reviews", altered)).json()).ready).toBe(
      false,
    );

    const targetSlug = "moved-link-target",
      targetRoom = crypto.randomUUID();
    await seedEvent(crypto.randomUUID(), targetSlug, targetRoom);
    const fresh = transferPrepareSchema.parse({
      ...input(),
      document,
      resolutions: { ...input().resolutions, rooms: { [nextRoom]: targetRoom } },
    });
    const unresolved = transferReviewSchema.parse(
      await (await request(targetSlug, "/transfers/reviews", fresh)).json(),
    );
    expect(unresolved.ready).toBe(false);
    expect(unresolved.findings).toContainEqual(
      expect.objectContaining({ field: "archive", code: "invalid_reference" }),
    );
    fresh.resolutions.rooms[roomId] = targetRoom;
    const imported = await apply(targetSlug, fresh);
    expect(imported.agenda.occurrences[0]!.history!.legacyFragments[0]).toEqual({
      ...occurrence.history!.legacyFragments[0],
      roomId: targetRoom,
    });
  });
  it("exports a removed historical room with a bounded display label while retaining its full authored mapping", async () => {
    const authoredRoomRef = "r".repeat(300),
      value = input(),
      row = value.document.occurrences[0]!,
      nextRoom = crypto.randomUUID();
    value.document.rooms[0]!.ref = authoredRoomRef;
    row.roomRefs = [authoredRoomRef];
    row.archive!.legacyFragments[0]!.roomRef = authoredRoomRef;
    await env.DB.prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity) VALUES(?,?,?,20)")
      .bind(nextRoom, eventId, "Remaining room")
      .run();
    const moved = await movedAgenda((await apply(slug, value)).agenda, nextRoom);
    await env.DB.prepare("DELETE FROM event_agenda_rooms WHERE id=? AND event_id=?").bind(roomId, eventId).run();
    const document = await exportedDocument(slug);
    expect(document.rooms.find((room) => room.ref === roomId)).toEqual({
      ref: roomId,
      label: authoredRoomRef.slice(0, 160),
      canonicalRoomId: roomId,
    });
    expect(document.occurrences[0]!.archive!.legacyFragments[0]).toEqual(row.archive!.legacyFragments[0]);
    const ownReview = transferReviewSchema.parse(
      await (
        await request(slug, "/transfers/reviews", {
          ...value,
          document,
          expectedRevision: moved.revision,
        })
      ).json(),
    );
    expect(ownReview.ready, JSON.stringify(ownReview.findings)).toBe(true);
    const targetSlug = "removed-room-target",
      targetRoom = crypto.randomUUID();
    await seedEvent(crypto.randomUUID(), targetSlug, targetRoom);
    const fresh = transferPrepareSchema.parse({
      ...value,
      document,
      resolutions: { ...value.resolutions, rooms: { [nextRoom]: targetRoom, [roomId]: targetRoom } },
    });
    const imported = await apply(targetSlug, fresh);
    expect(imported.agenda.occurrences[0]!.history!.legacyFragments[0]).toEqual({
      ...row.archive!.legacyFragments[0],
      roomId: targetRoom,
    });
    expect(imported.agenda.occurrences[0]!.roomId).toBe(targetRoom);
  });
  it.each(["replaced", "withdrawn"] as const)(
    "exports %s presentation receipts without requiring stale current media or granting release",
    async (change) => {
      const value = input(),
        row = value.document.occurrences[0]!,
        originalUrl = "/content-media/events/original/slides.pdf";
      row.media = [
        { kind: "presentation", authoredReference: "slides.pdf", publicUrl: originalUrl, sourceDigest, bytes: null },
      ];
      row.archive!.legacyDownloads = sessionHistoryMetadataSchema.shape.legacyDownloads.parse([
        {
          url: "/events/original/slides.pdf",
          targetUrl: originalUrl,
          sourcePath,
          sourceDigest,
          sourceLocator: row.ref,
        },
      ]);
      const imported = await apply(slug, value);
      const released = await savedHistory(
        imported.agenda,
        imported.agenda.occurrences[0]!.history!.materials.map((material) => ({
          ...material,
          rightsConfirmed: true,
          consentConfirmed: true,
          validated: true,
          status: "approved",
          approvedAt: clock,
        })),
      );
      const original = released.occurrences[0]!.history!.materials[0]!;
      const nextUrl = "/content-media/events/original/replacement.pdf";
      const changed = await savedHistory(released, [
        { ...original, status: "withdrawn" },
        ...(change === "replaced"
          ? [{ ...original, id: crypto.randomUUID(), version: 2, url: nextUrl, title: "Replacement slides" }]
          : []),
      ]);
      expect(changed.occurrences[0]!.presentationUrl).toBe(change === "replaced" ? nextUrl : null);
      const document = await exportedDocument(slug);
      expect(document.occurrences[0]!.archive!.legacyDownloads).toEqual(row.archive!.legacyDownloads);
      expect(document.occurrences[0]!.media.map((media) => media.publicUrl)).toEqual(
        change === "replaced" ? [nextUrl] : [],
      );
      const sameEvent = transferPrepareSchema.parse({ ...value, document, expectedRevision: changed.revision });
      const review = transferReviewSchema.parse(await (await request(slug, "/transfers/reviews", sameEvent)).json());
      expect(review.ready, JSON.stringify(review.findings)).toBe(true);
      const withoutReceipt = structuredClone(sameEvent);
      withoutReceipt.document.occurrences[0]!.retainedSourceEvidence = [];
      expect(
        transferReviewSchema.parse(await (await request(slug, "/transfers/reviews", withoutReceipt)).json()).ready,
      ).toBe(false);

      const targetSlug = `download-${change}`,
        targetRoom = crypto.randomUUID();
      await seedEvent(crypto.randomUUID(), targetSlug, targetRoom);
      const fresh = transferPrepareSchema.parse({
        ...value,
        document,
        resolutions: { ...value.resolutions, rooms: { [roomId]: targetRoom } },
      });
      const transferredAgenda = (await apply(targetSlug, fresh)).agenda,
        transferred = transferredAgenda.occurrences[0]!;
      expect(transferred.history!.legacyDownloads).toEqual(row.archive!.legacyDownloads);
      expect(transferred.presentationUrl).toBeNull();
      expect(
        transferred.history!.materials.every(
          (material) =>
            !material.rightsConfirmed &&
            !material.consentConfirmed &&
            !material.validated &&
            material.approvedAt === null,
        ),
      ).toBe(true);
      expect(transferred.history!.materials.find((material) => material.url === originalUrl)!.status).toBe("withdrawn");
      expect(
        agendaContent(publicAgendaProjection(transferredAgenda, null)).days[0]!.slots[0]!.sessions[0]!.presentationUrl,
      ).toBeUndefined();
    },
  );
  it("retains observed slash IDs and refuses editing their authored evidence through history", async () => {
    const result = await apply(slug, input()),
      occurrence = result.agenda.occurrences[0]!;
    expect(occurrence.history!.legacyFragments[0]).toMatchObject({
      anchor: "sessionModal-830-0-hw/fw",
      authoredStart: "8:30",
      roomId,
    });
    const response = await request(slug, `/occurrences/${occurrence.id}/history`, {
      expectedRevision: result.agenda.revision,
      history: { ...occurrence.history, legacyFragments: [] },
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("HISTORICAL_LINK_PROVENANCE_IMMUTABLE");
  });
  it("remaps only the canonical room when a portable archive enters another event", async () => {
    await apply(slug, input());
    const document = await exportAgendaTransfer(
      env.DB,
      eventId,
      slug,
      agendaOccurrenceQuerySchema.parse({ limit: 100 }),
    );
    const targetId = crypto.randomUUID(),
      targetRoom = crypto.randomUUID(),
      targetSlug = "legacy-link-target";
    await seedEvent(targetId, targetSlug, targetRoom);
    const value = transferPrepareSchema.parse({
      document,
      mode: "archive",
      expectedRevision: 0,
      resolutions: { ...input().resolutions, rooms: { [roomId]: targetRoom } },
    });
    const result = await apply(targetSlug, value);
    expect(result.agenda.occurrences[0]!.history!.legacyFragments[0]).toMatchObject({
      roomRef: "Authored room",
      roomId: targetRoom,
      authoredTitle: "HW/FW",
      sourceLocator: "original-row",
    });
    expect(result.agenda.occurrences[0]!.roomId).toBe(targetRoom);
    const copied = transferPrepareSchema.parse({
      ...value,
      mode: "copy_as_new",
      expectedRevision: result.agenda.revision,
    });
    copied.document.occurrences[0]!.timing.startAt = "2023-04-01T10:00:00.000Z";
    copied.document.occurrences[0]!.timing.endAt = "2023-04-01T10:30:00.000Z";
    const copy = await apply(targetSlug, copied);
    expect(
      copy.agenda.occurrences.find((item) => item.id !== result.agenda.occurrences[0]!.id)!.history?.legacyFragments ??
        [],
    ).toEqual([]);
  });
  it("blocks wrong source evidence and foreign room bindings before mutation", async () => {
    const value = input();
    value.document.occurrences[0]!.archive!.legacyFragments[0]!.sourceDigest = "b".repeat(64);
    const checked = await request(slug, "/transfers/reviews", value);
    const review = transferReviewSchema.parse(await checked.json());
    expect(review.ready).toBe(false);
    expect(review.findings).toContainEqual(
      expect.objectContaining({ field: "archive", code: "invalid_reference", severity: "blocking" }),
    );
    const otherRoom = crypto.randomUUID();
    value.document.occurrences[0]!.archive!.legacyFragments[0]!.sourceDigest = sourceDigest;
    value.document.rooms[0]!.canonicalRoomId = otherRoom;
    value.document.occurrences[0]!.archive!.legacyFragments[0]!.roomId = otherRoom;
    const foreign = await request(slug, "/transfers/reviews", value);
    expect(transferReviewSchema.parse(await foreign.json()).ready).toBe(false);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_occurrences WHERE event_id=?")
        .bind(eventId)
        .first<{ count: number }>())!.count,
    ).toBe(0);
  });
});
