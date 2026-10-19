import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareAgendaMediaUpload,
  importAgendaMedia,
  agendaMediaStateSchema,
} from "../../scripts/lib/agenda-media-import-client.mjs";
import { createTemporaryDirectory } from "./helpers/temporary-directory";
import {
  SESSION_PRESENTATION_SOURCE_KEY_HEADER,
  SESSION_PRESENTATION_SOURCE_DIGEST_HEADER,
} from "../../assets/shared/schemas/session-presentation-versions";
const roots: string[] = [];
const occurrenceId = "11111111-1111-4111-8111-111111111111",
  versionId = "22222222-2222-4222-8222-222222222222";
async function fixture() {
  const root = await createTemporaryDirectory("agenda-media-import");
  roots.push(root);
  await mkdir(resolve(root, "content/events/example"), { recursive: true });
  const bytes = Buffer.from("%PDF-1.4\npublic synthetic evidence\n%%EOF");
  const filePath = resolve(root, "content/events/example/slides.pdf");
  await writeFile(filePath, bytes);
  const report = {
    sourcePath: "content/events/example/_index.md",
    assets: [
      {
        kind: "presentation",
        authoredReference: "slides*.pdf",
        relativePath: "slides.pdf",
        publicUrl: "/content-media/events/example/slides.pdf",
        sourceDigest: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      },
    ],
  };
  const assets = await prepareAgendaMediaUpload(report, { "slides*.pdf": occurrenceId }, root);
  return { root, report, assets, filePath };
}
function version(asset: Awaited<ReturnType<typeof prepareAgendaMediaUpload>>[number]) {
  return {
    id: versionId,
    occurrenceId,
    versionNumber: 1,
    fileName: "slides.pdf",
    fileSize: asset.bytes,
    mimeType: "application/pdf",
    uploadedByUserId: null,
    uploadedAt: "2026-10-04T10:00:00.000Z",
    isCurrent: true,
    deletedAt: null,
    latestReview: null,
    sourceKey: asset.sourceKey,
    sourceDigest: asset.sourceDigest,
  };
}
const page = (versions: ReturnType<typeof version>[] = []) => ({
  versions,
  page: { limit: 200, offset: 0, total: versions.length, hasMore: false },
});
const destination = { baseUrl: "https://example.test", eventSlug: "archive", token: "synthetic-token" };
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe("Reviewed historical PDF migration", () => {
  it("verifies explicit mappings and source bytes while default review performs no network writes", async () => {
    const { assets, root, report } = await fixture(),
      fetcher = vi.fn<typeof fetch>();
    expect(assets[0]).toMatchObject({
      sourceKey: "content/events/example/slides.pdf",
      publicUrl: report.assets[0].publicUrl,
    });
    expect(await importAgendaMedia({ ...destination, assets, fetcher })).toMatchObject({
      planned: 1,
      uploaded: 0,
      applied: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(prepareAgendaMediaUpload(report, {}, root)).rejects.toThrow("Map every");
    await expect(
      prepareAgendaMediaUpload(
        { ...report, sourcePath: "../outside/_index.md" },
        { "slides*.pdf": occurrenceId },
        root,
      ),
    ).rejects.toThrow("repository-relative source reference");
  });
  it("uploads private drafts with canonical provenance headers and durable resumable receipts", async () => {
    const { assets } = await fixture(),
      saves: Array<ReturnType<typeof agendaMediaStateSchema.parse>> = [];
    const fetcher = vi.fn<typeof fetch>(async (_url, request) => {
      if (request?.method === "POST") {
        expect(saves.at(-1)?.receipts[0].state).toBe("pending");
        return Response.json({ version: version(assets[0]) });
      }
      return Response.json(page());
    });
    const result = await importAgendaMedia({
      ...destination,
      assets,
      apply: true,
      fetcher,
      saveState: async (state) => {
        saves.push(structuredClone(state));
      },
    });
    expect(result).toMatchObject({ uploaded: 1, applied: true });
    const request = fetcher.mock.calls[1][1]!;
    expect(request.headers).toMatchObject({
      [SESSION_PRESENTATION_SOURCE_KEY_HEADER]: encodeURIComponent(assets[0].sourceKey),
      [SESSION_PRESENTATION_SOURCE_DIGEST_HEADER]: assets[0].sourceDigest,
      "content-type": "application/pdf",
    });
    expect(request.redirect).toBe("error");
    expect(saves.at(-1)?.receipts[0]).toMatchObject({
      state: "uploaded",
      versionId,
      sourcePath: "content/events/example/_index.md",
      publicUrl: assets[0].publicUrl,
    });
    expect(JSON.stringify(saves)).not.toContain("synthetic-token");
    expect(JSON.stringify(saves)).not.toContain(assets[0].filePath);
  });
  it("reconciles a lost upload response and safely replays pending attempts when absent from the first page", async () => {
    const { assets } = await fixture();
    let state = agendaMediaStateSchema.parse({ ...destination, receipts: [] });
    const lost = vi.fn<typeof fetch>(async (_url, request) => {
      if (request?.method === "POST") throw new Error("Lost response");
      return Response.json(page());
    });
    const saveState = async (next: typeof state) => {
      state = structuredClone(next);
    };
    await expect(importAgendaMedia({ ...destination, assets, apply: true, fetcher: lost, saveState })).rejects.toThrow(
      "Lost response",
    );
    expect(state.receipts[0].state).toBe("pending");
    const reconcile = vi.fn<typeof fetch>(async () => Response.json(page([version(assets[0])])));
    expect(
      await importAgendaMedia({ ...destination, assets, state, apply: true, fetcher: reconcile, saveState }),
    ).toMatchObject({ uploaded: 0, reconciled: 1 });
    expect(reconcile).toHaveBeenCalledTimes(1);
    const replay = vi.fn<typeof fetch>(async (_url, request) =>
      Response.json(request?.method === "POST" ? { version: version(assets[0]) } : page()),
    );
    expect(
      await importAgendaMedia({ ...destination, assets, state, apply: true, fetcher: replay, saveState }),
    ).toMatchObject({ uploaded: 1 });
    expect(state.receipts).toHaveLength(1);
  });
  it("refuses changed bytes before upload and receipts for another destination", async () => {
    const { assets, filePath } = await fixture();
    await writeFile(filePath, "%PDF-1.4\nchanged");
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(page()));
    await expect(
      importAgendaMedia({ ...destination, assets, apply: true, fetcher, saveState: async () => {} }),
    ).rejects.toThrow("PDF size changed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(
      importAgendaMedia({
        ...destination,
        assets,
        state: { baseUrl: "https://other.test", eventSlug: "archive", receipts: [] },
      }),
    ).rejects.toThrow("different destination");
  });
});
