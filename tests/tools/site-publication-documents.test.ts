import { sitePublicationSnapshotSchema } from "../../assets/shared/schemas/site-publication";
import {
  collectDocumentRedirects,
  assertDocumentRoutesSnapshot,
  documentFilePath,
  validateDocumentRoutes,
  validateDocumentRedirectRules,
} from "../../scripts/publication/collect-document-redirects.mjs";
import { sessionPresentationPublicUrl } from "../../assets/shared/session-presentation-public-url";
import { sessionMaterialSchema } from "../../assets/shared/schemas/event-session-history";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPublicDocuments } from "../../scripts/publication/verify-public-documents.mjs";
import type { PublishedDocument } from "../../functions/_lib/services/site-publication-documents";
import { publicationDocumentGrantHashInput } from "../../assets/shared/schemas/site-publication-documents";
const base: PublishedDocument = {
  eventId: "event",
  occurrenceId: "session",
  materialId: "slides",
  versionId: "version",
  digest: "",
  r2Key: "private/version",
  fileSize: 0,
};
function stream(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}
describe("Publication PDF verification", () => {
  it("accepts verified bytes without creating public build assets", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\nDocument\n%%EOF"),
      digest = createHash("sha256").update(bytes).digest("hex");
    const document = { ...base, digest, fileSize: bytes.length };
    await expect(
      verifyPublicDocuments([document], async () => ({
        size: bytes.length,
        etag: "verified-etag",
        body: stream([bytes.subarray(0, 2), bytes.subarray(2)]),
      })),
    ).resolves.toEqual([expect.objectContaining({ objectEtag: expect.any(String) })]);
    await expect(
      verifyPublicDocuments([{ ...document, digest: "0".repeat(64) }], async () => ({
        size: bytes.length,
        etag: "verified-etag",
        body: stream([bytes]),
      })),
    ).rejects.toThrow("content digest");
    await expect(verifyPublicDocuments([document], async () => null)).rejects.toThrow("missing");
  });
  it("streams a PDF larger than the Static Assets limit with bounded chunks", async () => {
    const chunk = new Uint8Array(256 * 1024),
      prefix = new TextEncoder().encode("%PDF-1.7\n");
    const count = 104,
      hash = createHash("sha256").update(prefix);
    for (let i = 0; i < count; i++) hash.update(chunk);
    const size = prefix.length + chunk.length * count;
    let emitted = -1;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted === -1) {
          controller.enqueue(prefix);
          emitted = 0;
        } else if (emitted < count) {
          controller.enqueue(chunk);
          emitted++;
        } else controller.close();
      },
    });
    expect(size).toBeGreaterThan(25 * 1024 * 1024);
    await expect(
      verifyPublicDocuments([{ ...base, digest: hash.digest("hex"), fileSize: size }], async () => ({
        size,
        etag: "large-etag",
        body,
      })),
    ).resolves.toEqual([expect.objectContaining({ objectEtag: expect.any(String) })]);
    expect(emitted).toBe(count);
  });
  it("refuses arbitrary bytes even with a matching digest", async () => {
    const bytes = new TextEncoder().encode("not a PDF");
    await expect(
      verifyPublicDocuments(
        [{ ...base, digest: createHash("sha256").update(bytes).digest("hex"), fileSize: bytes.length }],
        async () => ({ size: bytes.length, etag: "verified-etag", body: stream([bytes]) }),
      ),
    ).rejects.toThrow("content digest");
  });
});

function boundSelection() {
  const occurrenceId = "1".repeat(32),
    versionId = "2".repeat(32);
  const pdf = new TextEncoder().encode("%PDF-1.7\nExact historical bytes\n%%EOF");
  const digest = createHash("sha256").update(pdf).digest("hex");
  const inputReceipt = {
    url: "/events/2023/authored/Exact%C2%A0PDF.pdf",
    targetUrl: "/content-media/events/2023/authored/Exact%C2%A0PDF.pdf",
    sourcePath: "content/events/2023/authored/index.md",
    sourceDigest: "a".repeat(64),
    sourceLocator: "agenda.day[0].sessions[0]",
    pdfDigest: digest,
    pdfBytes: pdf.length,
  };
  const inputMaterial = sessionMaterialSchema.parse({
    id: "historical-slides",
    kind: "presentation",
    title: "Slides",
    version: 3,
    presentationSource: "session",
    presentationVersionId: versionId,
    legacyDownloadUrl: inputReceipt.url,
    url: sessionPresentationPublicUrl({ eventSlug: "new-event", occurrenceId, versionId, digest }),
    status: "approved",
    rightsConfirmed: true,
    consentConfirmed: true,
    validated: true,
    approvedAt: "2026-10-05T00:00:00.000Z",
  });
  const snapshot = sitePublicationSnapshotSchema.parse({
    version: 1,
    snapshotId: "f".repeat(64),
    sourceSequence: 7,
    eventAgendas: {
      "new-event": {
        eventSlug: "new-event",
        timeZone: "UTC",
        publishedRevision: 1,
        revision: 1,
        rooms: [],
        blocks: [],
        roleMembers: [],
        assignments: [],
        occurrences: [
          {
            id: occurrenceId,
            title: "Historical session",
            startAt: null,
            endAt: null,
            roomId: null,
            speakers: [],
            history: { materials: [inputMaterial], legacyDownloads: [inputReceipt] },
          },
        ],
      },
    },
    votes: [],
    publicResources: {},
    members: [],
    groups: {},
    groupMembers: {},
    sponsors: {},
    memberWall: [],
    news: [],
    sponsorNews: [],
  });
  const occurrence = snapshot.eventAgendas!["new-event"].occurrences[0]!;
  const material = occurrence.history!.materials[0]!;
  const receipt = occurrence.history!.legacyDownloads[0]!;
  const document = {
    ...base,
    eventId: "3".repeat(32),
    occurrenceId,
    materialId: material.id,
    versionId,
    digest,
    fileSize: pdf.length,
    legacyDownload: receipt,
  };
  return { snapshot, document, pdf, material, receipt, occurrence };
}

function selectionDatabase(fixture: ReturnType<typeof boundSelection>, metadata: unknown) {
  return {
    prepare: () => ({
      bind: () => ({
        all: async () => ({
          results: [
            {
              ...fixture.document,
              eventSlug: "new-event",
              versionNumber: fixture.material.version,
              latestReviewId: "approved-review",
              metadataJson: JSON.stringify(metadata),
            },
          ],
        }),
      }),
    }),
  };
}

it("retains a frozen PDF selection and exact receipt through title edits and unrelated draft candidates", async () => {
  const source = "../../functions/_lib/services/site-publication-documents";
  const { resolvePublishedDocuments } = await import(source);
  const fixture = boundSelection();
  const current = {
    ...fixture.occurrence.history,
    materials: [
      { ...fixture.material, title: "Unpublished editorial title" },
      {
        ...fixture.material,
        id: "candidate",
        title: "Unreleased candidate",
        legacyDownloadUrl: null,
        status: "draft",
        approvedAt: null,
      },
    ],
  };
  expect(await resolvePublishedDocuments(selectionDatabase(fixture, current), fixture.snapshot)).toEqual([
    expect.objectContaining(fixture.document),
  ]);
  expect(fixture.material.title).toBe("Slides");
  expect(fixture.occurrence.history!.materials).toEqual([fixture.material]);
});

it.each([
  "draft",
  "withdrawn",
  "rights",
  "consent",
  "validation",
  "version",
  "approval",
  "url",
  "legacy binding",
  "receipt bytes",
  "receipt digest",
])("refuses a historical PDF selection after current %s changes", async (change) => {
  const source = "../../functions/_lib/services/site-publication-documents";
  const { resolvePublishedDocuments } = await import(source);
  const fixture = boundSelection();
  const material = { ...fixture.material },
    receipt = { ...fixture.receipt };
  if (change === "draft" || change === "withdrawn") material.status = change;
  if (change === "rights") material.rightsConfirmed = false;
  if (change === "consent") material.consentConfirmed = false;
  if (change === "validation") material.validated = false;
  if (change === "version") material.version++;
  if (change === "approval") material.approvedAt = "2026-10-05T00:00:01.000Z";
  if (change === "url") material.url = "https://example.test/changed.pdf";
  if (change === "legacy binding") material.legacyDownloadUrl = null;
  if (change === "receipt bytes") receipt.pdfBytes!++;
  if (change === "receipt digest") receipt.pdfDigest = "0".repeat(64);
  const current = { ...fixture.occurrence.history, materials: [material], legacyDownloads: [receipt] };
  await expect(resolvePublishedDocuments(selectionDatabase(fixture, current), fixture.snapshot)).rejects.toThrow(
    change.startsWith("receipt") ? "receipt does not bind" : "selection changed",
  );
  expect(fixture.material).toEqual(fixture.occurrence.history!.materials[0]);
});

it("derives exact encoded paired redirects from native verified bytes, allowing an explicitly migrated event folder", async () => {
  const { snapshot, document, pdf, material, receipt } = boundSelection();
  const verified = await verifyPublicDocuments([document], async () => ({
    size: pdf.length,
    etag: "private-object-etag",
    body: stream([pdf]),
  }));
  const routes = collectDocumentRedirects(snapshot, verified);
  expect(routes.documents).toEqual([
    {
      url: material.url,
      grantId: createHash("sha256")
        .update(
          publicationDocumentGrantHashInput({
            eventSlug: "new-event",
            occurrenceId: document.occurrenceId,
            versionId: document.versionId,
            digest: document.digest,
            materialId: material.id,
            approvedAt: material.approvedAt!,
            approvalNonce: material.approvalNonce ?? null,
          }),
        )
        .digest("hex"),
    },
  ]);
  expect(JSON.stringify(routes)).not.toContain(document.r2Key);
  expect(() =>
    assertDocumentRoutesSnapshot(snapshot, { ...routes, documents: [{ url: material.url, grantId: "0".repeat(64) }] }),
  ).toThrow("selected publication snapshot");
  expect(routes.redirects).toEqual([
    { from: receipt.targetUrl, to: material.url, status: 302 },
    { from: receipt.url, to: material.url, status: 302 },
  ]);
  expect(routes.retiredPaths.map(({ path }: { path: string }) => path)).toEqual([
    "content-media/events/2023/authored/Exact\u00a0PDF.pdf",
    "events/2023/authored/Exact\u00a0PDF.pdf",
  ]);
  expect(routes.documents.map((selection) => Object.keys(selection).sort())).toEqual([["grantId", "url"]]);
  expect(JSON.stringify(routes)).not.toContain(verified[0]!.objectEtag);
  expect(JSON.stringify(routes)).not.toMatch(/r2Key|objectEtag|private\/version|publication-documents\//i);
  expect(() => collectDocumentRedirects(snapshot, [])).toThrow("native byte verification");
  expect(() => collectDocumentRedirects(snapshot, [{ ...verified[0], fileSize: pdf.length + 1 }])).toThrow(
    "native byte verification",
  );
  expect(() => collectDocumentRedirects(snapshot, [{ ...verified[0], versionId: "4".repeat(32) }])).toThrow(
    "native byte verification",
  );
  receipt.pdfDigest = "0".repeat(64);
  expect(() => collectDocumentRedirects(snapshot, verified)).toThrow("canonical bytes");
});

it("refuses route/retirement tampering, decoded collisions, unsafe paths and provider loops or overflow", () => {
  const { snapshot, document, receipt, material } = boundSelection();
  const routes = collectDocumentRedirects(snapshot, [{ ...document, objectEtag: "verified" }]);
  expect(() => assertDocumentRoutesSnapshot(snapshot, { ...routes, retiredPaths: [] })).toThrow();
  expect(() =>
    validateDocumentRoutes({
      ...routes,
      retiredPaths: routes.retiredPaths.map((entry: { path: string; sha256: string; bytes: number }) => ({
        ...entry,
        bytes: entry.bytes + (entry.path.startsWith("events/") ? 1 : 0),
      })),
    }),
  ).toThrow("pairs disagree");
  for (const path of [
    "/events/event/../file.pdf",
    "/events/event/%2f.pdf",
    "/events/event/%252e.pdf",
    "/events/event/file.pdf?token=x",
    "/events/event/:file.pdf",
    "/events/event/*.pdf",
  ])
    expect(() => documentFilePath(path)).toThrow();
  const collision = structuredClone(routes);
  collision.redirects.push({ from: receipt.url.replace("Exact", "%45xact"), to: material.url, status: 302 });
  expect(() => validateDocumentRoutes(collision)).toThrow("colliding decoded paths");
  expect(() =>
    validateDocumentRedirectRules(
      [...routes.redirects, { from: "/a", to: "/b", status: 301 }, { from: "/b", to: "/a", status: 301 }],
      routes,
    ),
  ).toThrow("loop");
  expect(() => validateDocumentRedirectRules(routes.redirects, routes, "/api/* /elsewhere 302")).toThrow(
    "destination is redirected",
  );
  expect(() => validateDocumentRedirectRules(routes.redirects, routes, `${receipt.url} /elsewhere 302`)).toThrow();
  expect(() =>
    validateDocumentRedirectRules(
      [
        ...routes.redirects,
        ...Array.from({ length: 2000 }, (_, i) => ({ from: `/old-${i}`, to: "/target", status: 301 as const })),
      ],
      routes,
    ),
  ).toThrow("provider limits");
  expect(() =>
    validateDocumentRedirectRules(
      [...routes.redirects, { from: `/long-${"x".repeat(1000)}`, to: "/target", status: 301 }],
      routes,
    ),
  ).toThrow("line limit");
});

it("keeps activated retired paths on fresh withdrawn snapshots and prefers only an exactly owned current binding", () => {
  const { snapshot, document, material, receipt, occurrence } = boundSelection();
  const oldVersion = "4".repeat(32);
  const retained = {
    eventId: document.eventId,
    occurrenceId: document.occurrenceId,
    materialId: document.materialId,
    versionId: oldVersion,
    digest: document.digest,
    legacyDownload: receipt,
    url: sessionPresentationPublicUrl({
      eventSlug: "new-event",
      occurrenceId: document.occurrenceId,
      versionId: oldVersion,
      digest: document.digest,
    }),
  };
  const current = collectDocumentRedirects(snapshot, [{ ...document, objectEtag: "verified" }], [retained]);
  expect(current.redirects.every(({ to }: { to: string }) => to === material.url)).toBe(true);
  expect(() =>
    collectDocumentRedirects(
      snapshot,
      [{ ...document, objectEtag: "verified" }],
      [{ ...retained, eventId: "5".repeat(32) }],
    ),
  ).toThrow("retained ownership");
  occurrence.history!.materials = [];
  const withdrawn = collectDocumentRedirects(snapshot, [], [retained]);
  expect(withdrawn.redirects.every(({ to }: { to: string }) => to === retained.url)).toBe(true);
  expect(withdrawn.retiredPaths).toEqual(current.retiredPaths);
  expect(assertDocumentRoutesSnapshot(snapshot, withdrawn, [retained])).toEqual(withdrawn);
});
