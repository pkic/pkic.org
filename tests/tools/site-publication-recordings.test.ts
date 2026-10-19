import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPublicRecordings } from "../../scripts/publication/verify-public-recordings.mjs";
import {
  collectDocumentRedirects,
  assertDocumentRoutesSnapshot,
} from "../../scripts/publication/collect-document-redirects.mjs";
import { sessionRecordingPublicUrl } from "../../assets/shared/session-recording-public-url";
import { publicationDocumentGrantHashInput } from "../../assets/shared/schemas/site-publication-documents";
import { publicationRecordingAllowSchema } from "../../assets/shared/schemas/site-publication-recordings";
import type { PublishedRecording } from "../../functions/_lib/services/site-publication-recordings";
import { sitePublicationSnapshotSchema } from "../../assets/shared/schemas/site-publication";
import publicationFixture from "../fixtures/site-publication.json";
const bytes = new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
const basis = {
  kind: "recording" as const,
  eventId: "44444444-4444-4444-8444-444444444444",
  eventSlug: "synthetic-event",
  occurrenceId: "11111111-1111-4111-8111-111111111111",
  materialId: "public-recording",
  versionId: "22222222-2222-4222-8222-222222222222",
  digest: createHash("sha256").update(bytes).digest("hex"),
  r2Key: "private/owned-recording",
  fileSize: bytes.length,
  mimeType: "video/mp4" as const,
  objectEtag: "owned-etag",
  versionNumber: 1,
  approvedAt: "2026-10-07T00:00:00.000Z",
  approvalNonce: "33333333-3333-4333-8333-333333333333",
};
const recording: PublishedRecording = {
  ...basis,
  grantId: createHash("sha256").update(publicationDocumentGrantHashInput(basis)).digest("hex"),
};
function stream(value = bytes) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(value.subarray(0, 7));
      controller.enqueue(value.subarray(7));
      controller.close();
    },
  });
}
function snapshot() {
  return sitePublicationSnapshotSchema.parse({
    ...publicationFixture,
    snapshotId: "a".repeat(64),
    sourceSequence: 1,
    eventAgendas: {
      "synthetic-event": {
        eventSlug: basis.eventSlug,
        timeZone: "UTC",
        revision: 1,
        publishedRevision: 1,
        rooms: [],
        shifts: [],
        assignments: [],
        roleMembers: [],
        occurrences: [
          {
            id: basis.occurrenceId,
            title: "Synthetic recorded session",
            startAt: basis.approvedAt,
            endAt: "2026-10-07T01:00:00.000Z",
            roomId: null,
            speakers: [],
            history: {
              materials: [
                {
                  id: basis.materialId,
                  kind: "recording",
                  title: "Recording",
                  url: sessionRecordingPublicUrl(basis),
                  presentationVersionId: null,
                  recordingVersionId: basis.versionId,
                  version: 1,
                  rightsConfirmed: true,
                  consentConfirmed: true,
                  validated: true,
                  status: "approved",
                  approvedAt: basis.approvedAt,
                  approvalNonce: basis.approvalNonce,
                },
              ],
            },
          },
        ],
      },
    },
  });
}
describe("Owned recording publication evidence", () => {
  it("streams actual container bytes under the exact stored object identity", async () => {
    let options: unknown;
    await expect(
      verifyPublicRecordings([recording], async (key, value) => {
        expect(key).toBe(basis.r2Key);
        options = value;
        return { size: bytes.length, etag: basis.objectEtag, body: stream() };
      }),
    ).resolves.toEqual([recording]);
    expect(options).toEqual({ onlyIf: { etagMatches: basis.objectEtag } });
    expect(
      publicationRecordingAllowSchema.safeParse({ ...recording, version: 1, fileSize: 101 * 1024 * 1024 }).success,
    ).toBe(true);
  });
  it.each(["digest", "container", "size", "etag"])("refuses substituted %s evidence", async (field) => {
    const changed = bytes.slice();
    changed[8] = 0;
    const object = {
      size: bytes.length,
      etag: basis.objectEtag,
      body: stream(field === "container" ? changed : bytes),
    };
    const selected = { ...recording };
    if (field === "digest") selected.digest = "0".repeat(64);
    if (field === "container") selected.digest = createHash("sha256").update(changed).digest("hex");
    if (field === "size") object.size++;
    if (field === "etag") object.etag = "replacement-etag";
    await expect(verifyPublicRecordings([selected], async () => object)).rejects.toThrow(/recording/i);
  });
  it("emits only the exact verified release path and grant, never storage locations", () => {
    const source = snapshot();
    const routes = collectDocumentRedirects(source, [], [], [recording]);
    expect(routes.documents).toEqual([{ url: sessionRecordingPublicUrl(basis), grantId: recording.grantId }]);
    expect(routes.redirects).toEqual([]);
    expect(routes.retiredPaths).toEqual([]);
    expect(JSON.stringify(routes)).not.toContain(basis.r2Key);
    expect(assertDocumentRoutesSnapshot(source, routes)).toEqual(routes);
    expect(() => collectDocumentRedirects(source, [], [], [])).toThrow("native verification");
    expect(() => collectDocumentRedirects(source, [], [], [{ ...recording, materialId: "foreign-material" }])).toThrow(
      "native verification",
    );
    expect(() => collectDocumentRedirects(source, [], [], [{ ...recording, grantId: "0".repeat(64) }])).toThrow(
      "native verification",
    );
    const withdrawn = snapshot();
    const withdrawnMaterial = withdrawn.eventAgendas?.[basis.eventSlug]?.occurrences[0]?.history?.materials[0];
    if (!withdrawnMaterial) throw new Error("The canonical fixture must contain its selected recording material.");
    withdrawnMaterial.status = "withdrawn";
    expect(collectDocumentRedirects(withdrawn, [], [], []).documents).toEqual([]);
  });
  it("keeps PDF grants stable and separates identical recording tuple identities", () => {
    const { kind, ...pdf } = basis;
    expect(publicationDocumentGrantHashInput(pdf)).toBe(
      JSON.stringify([
        basis.eventSlug,
        basis.occurrenceId,
        basis.materialId,
        basis.versionId,
        basis.digest,
        basis.approvalNonce,
      ]),
    );
    expect(publicationDocumentGrantHashInput(recording)).not.toBe(publicationDocumentGrantHashInput(pdf));
    expect(kind).toBe("recording");
  });
});
