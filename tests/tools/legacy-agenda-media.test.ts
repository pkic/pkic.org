import { z } from "zod";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareLegacyAgendaImport } from "../../scripts/lib/legacy-agenda-import.mjs";
import inventoryFixture from "../fixtures/legacy-agenda-2023-media.json";
import { parseFrontMatter } from "../../functions/_lib/services/site-markdown";
import { canonicalLegacyRecordingUrl, resolveLegacyAgendaMedia } from "../../scripts/lib/legacy-agenda-media.mjs";
import { createTemporaryDirectory } from "./helpers/temporary-directory";

// Validate the authored input while preserving its original key order for the source digest.
const mediaSourceShape = z
  .object({
    agenda: z.record(
      z.string(),
      z.array(
        z
          .object({
            sessions: z
              .array(z.object({ presentation: z.string().optional(), youtube: z.string().optional() }).passthrough())
              .nullish(),
          })
          .passthrough(),
      ),
    ),
  })
  .passthrough();
const mediaSourceSchema = z.custom<Parameters<typeof resolveLegacyAgendaMedia>[0]>(
  (value) => mediaSourceShape.safeParse(value).success,
  "Expected an authored agenda with valid slide and recording references",
);

const roots: string[] = [];
const agenda = (references: string[]) => ({
  agenda: { "2023-03-03": [{ sessions: references.map((presentation) => ({ presentation })) }] },
});
async function fixture() {
  const root = await createTemporaryDirectory("legacy-agenda-media");
  roots.push(root);
  const event = resolve(root, "events/2023/conference");
  await mkdir(event, { recursive: true });
  await writeFile(resolve(event, "index.md"), "fixture");
  return {
    event,
    options: {
      sourcePath: resolve(event, "index.md"),
      contentRoot: root,
      publicBasePath: "/content-media/events/2023/conference",
    },
  };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("legacy agenda local media inventory", () => {
  it("resolves real authored 2023 slide bytes and preserves recording offsets", async () => {
    const sourcePath = resolve("content/events/2023/post-quantum-cryptography-conference/index.md");
    const source = mediaSourceSchema.parse(parseFrontMatter(await readFile(sourcePath, "utf8")).data.data);
    const result = await resolveLegacyAgendaMedia(source, {
      sourcePath,
      publicBasePath: "/content-media/events/2023/post-quantum-cryptography-conference",
    });
    expect(result.unresolved).toEqual([]);
    expect(result.mediaDigests).toEqual(inventoryFixture.mediaDigests);
    const prepared = prepareLegacyAgendaImport(source, { sourcePath: inventoryFixture.sourcePath, ...result });
    // Export time is a preparation receipt; all source/media fields must match current checkout evidence.
    prepared.document.source.exportedAt = inventoryFixture.document.source.exportedAt;
    const welcome = prepared.document.occurrences.find((row) => row.fields.title === "Welcome");
    expect(welcome).toBeDefined();
    expect({
      ...prepared.document,
      people: prepared.document.people.filter((person) => welcome!.personRefs.includes(person.ref)),
      rooms: prepared.document.rooms.filter((room) => welcome!.roomRefs.includes(room.ref)),
      occurrences: [welcome],
    }).toEqual({
      ...inventoryFixture.document,
      occurrences: inventoryFixture.document.occurrences.map((row) => ({
        ...row,
        // The Welcome slot names no format and is a real session, not a placeholder.
        fields: { ...row.fields, format: null, placeholder: false },
        personRoles: Object.fromEntries(
          inventoryFixture.document.people
            .filter((person) => row.personRefs.includes(person.ref))
            .map((person) => [person.ref, person.role]),
        ),
      })),
    });
    expect(prepared.unresolved.filter((finding) => finding.sourceKey === welcome!.sourceKey)).toEqual(
      inventoryFixture.preparationUnresolved,
    );
    expect(result.presentationUrls).toEqual(inventoryFixture.presentationUrls);
    expect(createHash("sha256").update(JSON.stringify(source)).digest("hex")).toBe(inventoryFixture.sourceDigest);
    const reference = "pkic-pqcc-welcome-paul-van-brouwershaven.pdf";
    const bytes = await readFile(resolve("content/events/2023/post-quantum-cryptography-conference", reference));
    expect(result.presentationUrls[reference]).toBe(
      `/content-media/events/2023/post-quantum-cryptography-conference/${reference}`,
    );
    expect(result.mediaDigests[reference]).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(result.recordingUrls["o-1sSF_xP5Q?start=1499"]).toBe(
      "https://www.youtube.com/watch?v=o-1sSF_xP5Q&start=1499",
    );
    expect(result.assets.find((asset) => asset.authoredReference === reference)).toMatchObject({
      bytes: bytes.length,
      sourceDigest: result.mediaDigests[reference],
    });
    expect(result.assets[0]).not.toHaveProperty("approvedAt");
  });

  it("reports ambiguity, missing files, traversal and symlinks without resolving them", async () => {
    const { event, options } = await fixture();
    await writeFile(resolve(event, "a.pdf"), "%PDF-1.7\nA");
    await writeFile(resolve(event, "b.pdf"), "%PDF-1.7\nB");
    await symlink(resolve(event, "a.pdf"), resolve(event, "link.pdf"));
    const result = await resolveLegacyAgendaMedia(
      agenda(["*.pdf", "missing.pdf", "../outside.pdf", "link.pdf"]),
      options,
    );
    expect(result.presentationUrls).toEqual({});
    expect(result.unresolved.map((item) => item.reason)).toEqual([
      "ambiguous_local_asset",
      "missing_local_asset",
      "unsafe_local_reference",
      "missing_local_asset",
    ]);
  });

  it("hashes a unique glob and requires a verified static base or explicit mapping", async () => {
    const { event, options } = await fixture();
    await mkdir(resolve(event, "slides"));
    await writeFile(resolve(event, "slides/talk.pdf"), "%PDF-1.7\nslides");
    const rejected = await resolveLegacyAgendaMedia(agenda(["slides/*.pdf"]), {
      ...options,
      publicBasePath: "/events/wrong",
    });
    expect(rejected.unresolved[0].reason).toBe("canonical_public_path_required");
    const mapped = await resolveLegacyAgendaMedia(agenda(["slides/*.pdf"]), {
      ...options,
      publicBasePath: undefined,
      presentationUrls: { "slides/*.pdf": "/archive/talk.pdf" },
    });
    expect(mapped.presentationUrls["slides/*.pdf"]).toBe("/archive/talk.pdf");
    expect(mapped.mediaDigests["slides/*.pdf"]).toMatch(/^[a-f0-9]{64}$/u);
    const derived = await resolveLegacyAgendaMedia(agenda(["slides/*.pdf"]), options);
    expect(derived.presentationUrls["slides/*.pdf"]).toBe("/content-media/events/2023/conference/slides/talk.pdf");
  });

  it("rejects non-PDF bytes and credentialed public mappings", async () => {
    const { event, options } = await fixture();
    await writeFile(resolve(event, "fake.pdf"), "not a PDF");
    const result = await resolveLegacyAgendaMedia(agenda(["fake.pdf", "secret.pdf"]), {
      ...options,
      presentationUrls: { "secret.pdf": "https://example.test/file?token=secret" },
    });
    expect(result.assets).toEqual([]);
    expect(result.unresolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "Local slide asset is not a PDF." }),
        expect.objectContaining({ reason: "invalid_public_url" }),
      ]),
    );
  });

  it.each([
    "abcdefghijk?start=-1",
    "abcdefghijk?start=1&token=x",
    "abcdefghijk?start=1.5",
    "abcdefghijk?start=01",
    "abcdefghijk?start=10000000000",
    "short",
  ])("rejects invalid recording reference %s", (reference) => {
    expect(canonicalLegacyRecordingUrl(reference)).toBeNull();
  });
  it("preserves the existing ten-digit offset boundary in the shared codec", () => {
    expect(canonicalLegacyRecordingUrl("abcdefghijk?start=9999999999")).toBe(
      "https://www.youtube.com/watch?v=abcdefghijk&start=9999999999",
    );
  });
  it("keeps explicit recording mapping and valid zero offset", async () => {
    const { options } = await fixture();
    const result = await resolveLegacyAgendaMedia(
      { agenda: { day: [{ sessions: [{ youtube: "legacy" }, { youtube: "abcdefghijk?start=0" }] }] } },
      { ...options, recordingUrls: { legacy: "https://example.test/recording" } },
    );
    expect(result.recordingUrls).toEqual({
      legacy: "https://example.test/recording",
      "abcdefghijk?start=0": "https://www.youtube.com/watch?v=abcdefghijk&start=0",
    });
    expect(result.mediaDigests).toEqual({});
  });
});

it("resolves only explicitly mapped local filenames with reviewed PDF evidence", async () => {
  const { event, options } = await fixture();
  const bytes = "%PDF-1.7\nreviewed";
  const relativePath = "quantum\u00a0authentication.pdf";
  await writeFile(resolve(event, relativePath), bytes);
  const sourceDigest = createHash("sha256").update(bytes).digest("hex");
  const source = agenda(["quantum authentication.pdf"]);
  expect((await resolveLegacyAgendaMedia(source, options)).unresolved[0]!.reason).toBe("missing_local_asset");
  const mapping = { relativePath, sourceDigest, bytes: Buffer.byteLength(bytes) };
  const result = await resolveLegacyAgendaMedia(source, {
    ...options,
    localPresentationFiles: { "quantum authentication.pdf": mapping },
    presentationUrls: { "quantum authentication.pdf": "/archive/original.pdf" },
  });
  expect(result.unresolved).toEqual([]);
  expect(result.assets[0]).toMatchObject({
    authoredReference: "quantum authentication.pdf",
    relativePath,
    sourceDigest,
    publicUrl: "/archive/original.pdf",
    localMapping: mapping,
  });
  for (const invalid of [
    { ...mapping, sourceDigest: "0".repeat(64) },
    { ...mapping, bytes: 1 },
    { ...mapping, relativePath: "../outside.pdf" },
    { ...mapping, relativePath: "*.pdf" },
  ]) {
    const rejected = await resolveLegacyAgendaMedia(source, {
      ...options,
      localPresentationFiles: { "quantum authentication.pdf": invalid },
    });
    expect(rejected.assets).toEqual([]);
    expect(rejected.unresolved).toHaveLength(1);
  }
});
