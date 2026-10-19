import { describe, expect, it } from "vitest";
import { MAX_PRESENTATION_BYTES } from "../assets/shared/presentation-upload";
import { legacyAgendaDownloadSchema } from "../assets/shared/schemas/event-agenda-legacy-fragments";
import { transferMediaSchema } from "../assets/shared/schemas/event-agenda-transfer";
import {
  sessionMaterialSchema,
  sessionHistoryMetadataSchema,
  verifiedSessionMaterialLegacyDownload,
} from "../assets/shared/schemas/event-session-history";
const authored = {
  url: "/events/pqc-2026/Slides%20Original.pdf",
  targetUrl: "/content-media/events/pqc-2026/Slides%20Original.pdf",
  sourcePath: "content/events/pqc-2026/agenda.md",
  sourceDigest: "a".repeat(64),
  sourceLocator: "days[0].slots[0].sessions[0]",
};
const receipt = legacyAgendaDownloadSchema.parse({ ...authored, pdfDigest: "b".repeat(64), pdfBytes: 42 });
const material = sessionMaterialSchema.parse({
  id: "slides",
  kind: "presentation",
  title: "Slides",
  url: "",
  presentationVersionId: "version",
  presentationSource: "session",
  version: 1,
  legacyDownloadUrl: receipt.url,
  rightsConfirmed: true,
  consentConfirmed: true,
  validated: true,
  status: "approved",
  approvedAt: "2026-10-04T00:00:00.000Z",
});
const version = {
  id: "version",
  versionNumber: 1,
  sourceDigest: receipt.pdfDigest,
  fileSize: 42,
  mimeType: "application/pdf",
};
describe("Canonical historical PDF binding contracts", () => {
  it("defaults old receipts and material selections to unknown without changing authored provenance or encoded URLs", () => {
    expect(legacyAgendaDownloadSchema.parse(authored)).toEqual({ ...authored, pdfDigest: null, pdfBytes: null });
    const { legacyDownloadUrl: ignored, ...oldMaterial } = material;
    expect(ignored).toBe(receipt.url);
    expect(sessionMaterialSchema.parse(oldMaterial).legacyDownloadUrl).toBeNull();
    expect(sessionHistoryMetadataSchema.parse({ legacyDownloads: [authored] }).legacyDownloads[0]).toEqual({
      ...authored,
      pdfDigest: null,
      pdfBytes: null,
    });
    expect(
      transferMediaSchema.parse({
        kind: "presentation",
        authoredReference: "Slides.pdf",
        publicUrl: null,
        sourceDigest: receipt.pdfDigest,
      }).bytes,
    ).toBeNull();
  });
  it.each([
    { pdfDigest: receipt.pdfDigest },
    { pdfBytes: 42 },
    { pdfDigest: null, pdfBytes: 42 },
    { pdfDigest: receipt.pdfDigest, pdfBytes: null },
  ])("refuses a partially proven receipt %j", (proof) => {
    expect(legacyAgendaDownloadSchema.safeParse({ ...authored, ...proof }).success).toBe(false);
  });
  it.each([0, -1, 1.5, MAX_PRESENTATION_BYTES + 1])(
    "refuses invalid byte count %s in both receipt and transfer",
    (bytes) => {
      expect(legacyAgendaDownloadSchema.safeParse({ ...receipt, pdfBytes: bytes }).success).toBe(false);
      expect(
        transferMediaSchema.safeParse({
          kind: "presentation",
          authoredReference: "Slides.pdf",
          publicUrl: null,
          sourceDigest: receipt.pdfDigest,
          bytes,
        }).success,
      ).toBe(false);
    },
  );
  it("uses the canonical upload maximum and requires an explicit matching selection", () => {
    expect(legacyAgendaDownloadSchema.parse({ ...receipt, pdfBytes: MAX_PRESENTATION_BYTES }).pdfBytes).toBe(
      MAX_PRESENTATION_BYTES,
    );
    expect(verifiedSessionMaterialLegacyDownload(material, [receipt], version)).toEqual(receipt);
    expect(
      verifiedSessionMaterialLegacyDownload({ ...material, legacyDownloadUrl: null }, [receipt], version),
    ).toBeNull();
    expect(
      verifiedSessionMaterialLegacyDownload(material, [legacyAgendaDownloadSchema.parse(authored)], version),
    ).toBeNull();
  });
  it.each([
    { id: "foreign" },
    { versionNumber: 2 },
    { sourceDigest: authored.sourceDigest },
    { fileSize: 43 },
    { mimeType: "application/octet-stream" },
  ])("refuses a different exact version tuple %j", (change) => {
    expect(verifiedSessionMaterialLegacyDownload(material, [receipt], { ...version, ...change })).toBeNull();
  });
  it("refuses proposal, external and nonpresentation selections and credentials", () => {
    expect(sessionMaterialSchema.safeParse({ ...material, presentationSource: "proposal" }).success).toBe(false);
    expect(
      sessionMaterialSchema.safeParse({ ...material, presentationVersionId: null, url: receipt.targetUrl }).success,
    ).toBe(false);
    expect(sessionMaterialSchema.safeParse({ ...material, kind: "recording" }).success).toBe(false);
    expect(
      sessionMaterialSchema.safeParse({ ...material, legacyDownloadUrl: `${receipt.url}?token=private` }).success,
    ).toBe(false);
  });
});
