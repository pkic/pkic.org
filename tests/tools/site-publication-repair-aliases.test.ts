import { createTemporaryDirectory } from "./helpers/temporary-directory";
import { describe, expect, it } from "vitest";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  publicationRepairAliasesSchema,
  publicationRepairAliasPaths,
} from "../../assets/shared/schemas/site-publication-repair-aliases";
import { sessionPresentationPublicUrl } from "../../assets/shared/session-presentation-public-url";
import { sitePublicationSnapshotSchema } from "../../assets/shared/schemas/site-publication";
import { sessionMaterialSchema } from "../../assets/shared/schemas/event-session-history";
import {
  collectDocumentRedirects,
  assertDocumentRoutesSnapshot,
  prepareDocumentRetirement,
  documentFilePath,
  validateDocumentRedirectRules,
} from "../../scripts/publication/collect-document-redirects.mjs";
import { readDocumentRepairAliases } from "../../scripts/publication/read-document-repair-aliases.mjs";
import { verifyPublicDocuments } from "../../scripts/publication/verify-public-documents.mjs";

function fixture() {
  const pdf = new TextEncoder().encode("%PDF-1.7\nReviewed repair bytes\n%%EOF");
  const digest = createHash("sha256").update(pdf).digest("hex");
  const [alias] = publicationRepairAliasesSchema.parse([
    {
      eventId: "3".repeat(32),
      eventSlug: "historical",
      occurrenceId: "1".repeat(32),
      materialId: "slides",
      versionId: "2".repeat(32),
      digest,
      bytes: pdf.length,
      sourcePath: "content/events/2023/historical/index.md",
      sourceDigest: "a".repeat(64),
      sourceKey: "legacy:authored",
      sourceRef: "2023-01-01:0:0",
      reviewedAt: "2026-10-01T00:00:00.000Z",
      urls: [
        "/events/2023/historical/Secure%20authentication.pdf",
        "/events/2023/historical/Secure%C2%A0authentication.pdf",
      ],
    },
  ]);
  const material = sessionMaterialSchema.parse({
    id: alias.materialId,
    kind: "presentation",
    title: "Slides",
    version: 1,
    presentationSource: "session",
    presentationVersionId: alias.versionId,
    url: sessionPresentationPublicUrl(alias),
    status: "approved",
    rightsConfirmed: true,
    consentConfirmed: true,
    validated: true,
    approvedAt: "2026-10-01T00:00:00.000Z",
  });
  const snapshot = sitePublicationSnapshotSchema.parse({
    version: 1,
    snapshotId: "f".repeat(64),
    sourceSequence: 7,
    eventAgendas: {
      historical: {
        eventSlug: "historical",
        timeZone: "UTC",
        revision: 1,
        publishedRevision: 1,
        rooms: [],
        shifts: [],
        roleMembers: [],
        assignments: [],
        occurrences: [
          {
            id: alias.occurrenceId,
            title: "Authored title",
            startAt: null,
            endAt: null,
            roomId: null,
            speakers: [],
            history: { materials: [material] },
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
  const document = {
    eventId: alias.eventId,
    eventSlug: alias.eventSlug,
    occurrenceId: alias.occurrenceId,
    materialId: alias.materialId,
    versionId: alias.versionId,
    digest,
    fileSize: pdf.length,
    r2Key: "private/owned-version",
    repairAliases: [alias],
    objectEtag: "verified-object",
  };
  return { alias, pdf, material, snapshot, document };
}

describe("explicit reviewed document repair aliases", () => {
  it("derives both exact spellings and URL families only from the native verified approved version", async () => {
    const { snapshot, alias, document, pdf, material } = fixture();
    const verified = await verifyPublicDocuments([document], async () => ({
      size: pdf.length,
      etag: "verified-object",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(pdf);
          controller.close();
        },
      }),
    }));
    const routes = collectDocumentRedirects(snapshot, verified, [], [], [alias]);
    expect(routes.redirects.map(({ from }) => from).sort()).toEqual(publicationRepairAliasPaths(alias).sort());
    expect(routes.redirects.every(({ to }) => to === material.url)).toBe(true);
    expect(routes.retiredPaths).toHaveLength(4);
    expect(routes.repairAliases).toEqual([alias]);
    expect(routes.retiredPaths.every(({ sha256, bytes }) => sha256 === alias.digest && bytes === pdf.length)).toBe(
      true,
    );
    expect(assertDocumentRoutesSnapshot(snapshot, routes, [], [alias])).toEqual(routes);
    expect(snapshot.eventAgendas!.historical.occurrences[0].history!.legacyDownloads).toEqual([]);
    expect(document).not.toHaveProperty("legacyDownload");
    expect(() => collectDocumentRedirects(snapshot, [], [], [], [alias])).toThrow("native verification");
  });

  it.each(["event", "occurrence", "material", "version", "digest", "bytes", "source", "etag"])(
    "refuses a changed %s binding",
    (field) => {
      const { snapshot, document, alias } = fixture();
      const changed = { ...alias };
      if (field === "event") changed.eventId = "9".repeat(32);
      if (field === "occurrence") changed.occurrenceId = "9".repeat(32);
      if (field === "material") changed.materialId = "other";
      if (field === "version") changed.versionId = "9".repeat(32);
      if (field === "digest") changed.digest = "9".repeat(64);
      if (field === "bytes") changed.bytes++;
      if (field === "source") changed.sourceDigest = "9".repeat(64);
      expect(() =>
        collectDocumentRedirects(
          snapshot,
          [{ ...document, objectEtag: field === "etag" ? "" : document.objectEtag }],
          [],
          [],
          [changed],
        ),
      ).toThrow();
    },
  );

  it("refuses unreviewed route widening, ambiguous encodings, foreign owners and private URLs", () => {
    const { snapshot, alias, document } = fixture();
    const routes = collectDocumentRedirects(snapshot, [document], [], [], [alias]);
    const widened = structuredClone(routes);
    widened.redirects.push({
      from: "/events/2023/historical/Other.pdf",
      to: sessionPresentationPublicUrl(alias),
      status: 302,
    });
    expect(() => assertDocumentRoutesSnapshot(snapshot, widened, [], [alias])).toThrow();
    expect(() =>
      assertDocumentRoutesSnapshot(
        snapshot,
        { ...routes, repairAliases: [{ ...alias, sourceDigest: "0".repeat(64) }] },
        [],
        [alias],
      ),
    ).toThrow();
    expect(
      publicationRepairAliasesSchema.safeParse([
        { ...alias, urls: [alias.urls[0], alias.urls[0].replace("Secure", "%53ecure")] },
      ]).success,
    ).toBe(false);
    for (const url of [
      "/events/../x.pdf",
      "/events/x/*.pdf",
      "/events/x/%2f.pdf",
      "/events/x/a.pdf?token=secret",
      "/api/v1/private/file.pdf",
    ])
      expect(publicationRepairAliasesSchema.safeParse([{ ...alias, urls: [url] }]).success).toBe(false);
    expect(() =>
      collectDocumentRedirects(snapshot, [document], [], [], [alias], [{ ...alias, materialId: "foreign" }]),
    ).toThrow("owners");
    expect(() =>
      validateDocumentRedirectRules(routes.redirects, routes, `${alias.urls[0]} /static-bypass.pdf 302`),
    ).toThrow();
  });

  it("refuses foreign absent event paths in collection and staged evidence with unchanged valid owner", () => {
    const { snapshot, alias, document } = fixture();
    const foreign = { ...alias, urls: ["/events/2023/another-event/Absent.pdf"] };
    expect(() =>
      collectDocumentRedirects(snapshot, [{ ...document, repairAliases: [foreign] }], [], [], [foreign]),
    ).toThrow("authored event route");
    const routes = collectDocumentRedirects(snapshot, [document], [], [], [alias]);
    expect(() => assertDocumentRoutesSnapshot(snapshot, { ...routes, repairAliases: [foreign] }, [], [alias])).toThrow(
      "authored event route",
    );
    expect(() => collectDocumentRedirects(snapshot, [document], [], [], [], [foreign])).toThrow("authored event route");
    expect(
      publicationRepairAliasesSchema.safeParse([{ ...alias, sourcePath: "content/events/2023/historical/_index.md" }])
        .success,
    ).toBe(true);
  });

  it("keeps activated repair routes on a fresh withdrawn snapshot without document delivery grants", () => {
    const { snapshot, alias, document } = fixture();
    const previous = collectDocumentRedirects(snapshot, [document], [], [], [alias]);
    snapshot.eventAgendas!.historical.occurrences[0].history!.materials = [];
    const fresh = collectDocumentRedirects(snapshot, [], [], [], [], [alias]);
    expect(fresh.documents).toEqual([]);
    expect(fresh.redirects).toEqual(previous.redirects);
    expect(fresh.retiredPaths).toEqual(previous.retiredPaths);
    expect(assertDocumentRoutesSnapshot(snapshot, fresh, [], [], [alias])).toEqual(fresh);
  });

  it("retires only exact owned bytes, tolerates an absent repaired spelling and refuses collisions atomically", async () => {
    const { snapshot, alias, document, pdf } = fixture();
    const routes = collectDocumentRedirects(snapshot, [document], [], [], [alias]);
    const root = await createTemporaryDirectory("repair-retirement");
    const exact = resolve(root, documentFilePath(alias.urls[1]));
    const wrong = resolve(root, documentFilePath(alias.urls[0]));
    try {
      await mkdir(resolve(exact, ".."), { recursive: true });
      await writeFile(exact, pdf);
      await writeFile(wrong, "%PDF-1.7\nUnrelated bytes");
      await expect(prepareDocumentRetirement([root], routes)).rejects.toThrow();
      expect(await readFile(exact)).toEqual(Buffer.from(pdf));
      await rm(wrong);
      await (
        await prepareDocumentRetirement([root], routes)
      )();
      await expect(readFile(exact)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads only explicit private mapping input and rejects public/staging inputs", async () => {
    const { alias } = fixture();
    const root = await createTemporaryDirectory("repair-input");
    try {
      const publicRoot = resolve(root, "public");
      await mkdir(publicRoot);
      await writeFile(resolve(root, "mapping.json"), JSON.stringify([alias]));
      await writeFile(resolve(publicRoot, "mapping.json"), JSON.stringify([alias]));
      expect(await readDocumentRepairAliases(resolve(root, "mapping.json"), [publicRoot])).toEqual([alias]);
      await expect(readDocumentRepairAliases(resolve(publicRoot, "mapping.json"), [publicRoot])).rejects.toThrow(
        "outside public",
      );
      await symlink(resolve(root, "mapping.json"), resolve(publicRoot, "linked-mapping.json"));
      await expect(readDocumentRepairAliases(resolve(publicRoot, "linked-mapping.json"), [publicRoot])).rejects.toThrow(
        "outside public",
      );
      expect(await readDocumentRepairAliases(undefined, [publicRoot])).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
