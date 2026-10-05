import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { legacyAgendaDownloads } from "../../scripts/lib/legacy-agenda-downloads.mjs";
import { prepareLegacyAgendaImport } from "../../scripts/lib/legacy-agenda-import.mjs";
import { resolveLegacyAgendaMedia } from "../../scripts/lib/legacy-agenda-media.mjs";
import { readLegacyAgendaSource } from "../../scripts/lib/legacy-agenda-preparation.mjs";
import retainedLinks from "../fixtures/legacy-agenda-fragments.json";

describe("original historical PDF bundle receipts", () => {
  it.each(retainedLinks)("preserves each observed old PDF href for $sourcePath", async (fixture) => {
    const { source } = readLegacyAgendaSource(await readFile(fixture.sourcePath, "utf8"), fixture.sourcePath);
    const media = await resolveLegacyAgendaMedia(source, {
      sourcePath: resolve(fixture.sourcePath),
      publicBasePath: `/${fixture.sourcePath
        .slice("content/".length)
        .replace(/\/[^/]+$/u, "")
        .replace(/^events/u, "content-media/events")}`,
    });
    const prepared = prepareLegacyAgendaImport(source, { sourcePath: fixture.sourcePath, ...media });
    const receipts = prepared.document.occurrences.flatMap((row) => row.archive?.legacyDownloads ?? []);
    expect(receipts.map((receipt) => receipt.url)).toEqual(fixture.downloadUrls);
    expect(
      receipts.every(
        (receipt) =>
          receipt.targetUrl === `/content-media${receipt.url}` &&
          receipt.sourceDigest === prepared.document.source.sourceDigest,
      ),
    ).toBe(true);
    for (const receipt of receipts) {
      const asset = media.assets.find((candidate) => candidate.publicUrl === receipt.targetUrl)!;
      const bytes = await readFile(resolve(dirname(fixture.sourcePath), asset.relativePath));
      expect(receipt.pdfDigest).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(receipt.pdfBytes).toBe(bytes.length);
      expect(receipt.pdfDigest).not.toBe(receipt.sourceDigest);
      expect(prepared.document.occurrences.flatMap((row) => row.media)).toContainEqual(
        expect.objectContaining({ publicUrl: receipt.targetUrl, sourceDigest: receipt.pdfDigest, bytes: bytes.length }),
      );
    }
  });

  it("does not turn filename substitutions, globs or public overrides into observed old hrefs", () => {
    const context = {
      sourcePath: "content/events/2023/conference/index.md",
      sourceDigest: "1".repeat(64),
      sourceKey: "row",
    };
    const verified = {
      authoredReference: "quantum authentication.pdf",
      relativePath: "quantum authentication.pdf",
      sourceDigest: "2".repeat(64),
      bytes: 123,
      publicUrl: "/content-media/events/2023/conference/quantum%20authentication.pdf",
    };
    expect(legacyAgendaDownloads({ presentation: verified.authoredReference }, context, [verified])).toEqual([
      expect.objectContaining({
        url: "/events/2023/conference/quantum%20authentication.pdf",
        targetUrl: verified.publicUrl,
        pdfDigest: verified.sourceDigest,
        pdfBytes: verified.bytes,
      }),
    ]);
    for (const asset of [
      { ...verified, relativePath: "quantum\u00a0authentication.pdf" },
      { ...verified, localMapping: { relativePath: verified.relativePath } },
      { ...verified, publicUrl: "/archive/override.pdf" },
      { ...verified, sourceDigest: "unverified" },
    ])
      expect(legacyAgendaDownloads({ presentation: verified.authoredReference }, context, [asset])).toEqual([]);
    expect(
      legacyAgendaDownloads({ presentation: "*.pdf" }, context, [{ ...verified, authoredReference: "*.pdf" }]),
    ).toEqual([]);
  });
});
