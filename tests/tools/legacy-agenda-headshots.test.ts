import { mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { createTemporaryDirectory } from "./helpers/temporary-directory";
import { resolveLegacyAgendaHeadshots } from "../../scripts/lib/legacy-agenda-headshots.mjs";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await createTemporaryDirectory("legacy-headshots");
  roots.push(root);
  const event = resolve(root, "events/2023/conference");
  await mkdir(resolve(event, "speakers"), { recursive: true });
  const sourcePath = resolve(event, "index.md");
  await writeFile(sourcePath, "Source");
  return { event, options: { sourcePath, contentRoot: root, publicBasePath: "/content-media/events/2023/conference" } };
}
it("uses exact authored ID or existing shared name slug and retains image provenance", async () => {
  const { event, options } = await fixture();
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const jpg = Buffer.from([255, 216, 255, 0]);
  await writeFile(resolve(event, "speakers/explicit.png"), png);
  await writeFile(resolve(event, "speakers/alex-smith.jpg"), jpg);
  const result = await resolveLegacyAgendaHeadshots(
    { speakers: [{ name: "Different Name", id: "explicit" }, { name: "Alex Smith" }] },
    options,
  );
  expect(result.unresolved).toEqual([]);
  expect(result.assets).toHaveLength(2);
  expect(result.assets[0]).toMatchObject({
    sourceRef: "Different Name",
    relativePath: "speakers/explicit.png",
    publicUrl: "/content-media/events/2023/conference/speakers/explicit.png",
    bytes: png.length,
    sourceDigest: createHash("sha256").update(png).digest("hex"),
  });
  expect(result.photoUrls["Alex Smith"]).toBe("/content-media/events/2023/conference/speakers/alex-smith.jpg");
});
it("reports ambiguity, absent photos and unsafe source references without guessing", async () => {
  const { event, options } = await fixture();
  await writeFile(resolve(event, "speakers/alex.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  await writeFile(resolve(event, "speakers/alex.jpg"), Buffer.from([255, 216, 255]));
  const result = await resolveLegacyAgendaHeadshots(
    { speakers: [{ name: "Alex" }, { name: "Missing" }, { name: "Unsafe", id: "../escape" }] },
    options,
  );
  expect(result.assets).toEqual([]);
  expect(result.unresolved.map((finding) => finding.reason)).toEqual([
    "ambiguous_local_asset",
    "missing_local_asset",
    "unsafe_local_reference",
  ]);
});
it("requires the exact existing public source path unless explicitly reviewed", async () => {
  const { event, options } = await fixture();
  await writeFile(resolve(event, "speakers/alex.jpg"), Buffer.from([255, 216, 255]));
  const source = { speakers: [{ name: "Alex" }] };
  expect(
    (await resolveLegacyAgendaHeadshots(source, { ...options, publicBasePath: "/wrong" })).unresolved[0]!.reason,
  ).toBe("canonical_public_path_required");
  const reviewed = await resolveLegacyAgendaHeadshots(source, {
    ...options,
    publicBasePath: "/wrong",
    historicalPeople: { Alex: { photoUrl: "/content-media/reviewed/alex.jpg" } },
  });
  expect(reviewed.photoUrls.Alex).toBe("/content-media/reviewed/alex.jpg");
});

it("keeps external YAML headshot discovery optional and refuses to invent a static public path", async () => {
  const { event, options } = await fixture();
  const externalRoot = await createTemporaryDirectory("external-headshot-yaml");
  roots.push(externalRoot);
  await mkdir(resolve(externalRoot, "speakers"));
  await writeFile(resolve(externalRoot, "speakers/alex.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const result = await resolveLegacyAgendaHeadshots(
    { speakers: [{ name: "Alex" }] },
    {
      ...options,
      sourcePath: resolve(externalRoot, "event.yaml"),
      publicBasePath: "/content-media/events/claimed",
    },
  );
  expect(result.assets).toEqual([]);
  expect(result.photoUrls).toEqual({});
  expect(result.unresolved).toEqual([
    { sourceRef: "Alex", authoredReference: "speakers/alex.*", reason: "canonical_public_path_required" },
  ]);
  expect(
    (await resolveLegacyAgendaHeadshots({}, { ...options, sourcePath: resolve(event, "unused.yaml") })).unresolved,
  ).toEqual([]);
});

async function mappedFixture() {
  const { event, options } = await fixture();
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  await writeFile(resolve(event, "speakers/alex.jpg"), png);
  const mapping = {
    relativePath: "speakers/alex.jpg",
    sourceDigest: createHash("sha256").update(png).digest("hex"),
    bytes: png.length,
    mediaType: "image/png" as const,
  };
  return { event, options, png, mapping, source: { speakers: [{ name: "Alex" }] } };
}
it("requires exact reviewed evidence for a source image format mismatch and preserves original provenance", async () => {
  const { options, mapping, source } = await mappedFixture();
  expect((await resolveLegacyAgendaHeadshots(source, options)).unresolved[0]?.reason).toBe(
    "invalid_or_changed_local_image",
  );
  const result = await resolveLegacyAgendaHeadshots(source, {
    ...options,
    localHeadshotFiles: { "speakers/alex.*": mapping },
  });
  expect(result.unresolved).toEqual([]);
  expect(result.assets[0]).toMatchObject({
    authoredReference: "speakers/alex.*",
    relativePath: "speakers/alex.jpg",
    originalPublicUrl: "/content-media/events/2023/conference/speakers/alex.jpg",
    localMapping: mapping,
    mediaType: "image/png",
    resolvedSourceFinding: "authored_extension_media_type_mismatch",
    authoredLocalPaths: ["speakers/alex.jpg"],
  });
});
it("rejects stale evidence, wrong declared formats, unsafe paths and unknown source mapping references", async () => {
  const { options, mapping, source } = await mappedFixture();
  for (const invalid of [
    { ...mapping, sourceDigest: "0".repeat(64) },
    { ...mapping, bytes: mapping.bytes + 1 },
    { ...mapping, mediaType: "image/jpeg" as const },
    { ...mapping, relativePath: "speakers/../alex.jpg" },
    { ...mapping, relativePath: "/speakers/alex.jpg" },
    { ...mapping, relativePath: "speakers/alex*.jpg" },
    { ...mapping, bytes: 0 },
  ]) {
    const result = await resolveLegacyAgendaHeadshots(source, {
      ...options,
      localHeadshotFiles: { "speakers/alex.*": invalid },
    });
    expect(result.assets).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
  }
  const unknown = await resolveLegacyAgendaHeadshots(source, {
    ...options,
    localHeadshotFiles: { "speakers/unknown.*": mapping },
  });
  expect(unknown.unresolved.map((finding) => finding.reason)).toContain("unknown_local_mapping_reference");
});
it("does not permit explicit evidence to select a symlink or duplicate authored person", async () => {
  const { event, options, mapping, source } = await mappedFixture();
  await symlink(resolve(event, "speakers/alex.jpg"), resolve(event, "speakers/reviewed.jpg"));
  const result = await resolveLegacyAgendaHeadshots(source, {
    ...options,
    localHeadshotFiles: { "speakers/alex.*": { ...mapping, relativePath: "speakers/reviewed.jpg" } },
  });
  expect(result.assets).toEqual([]);
  expect(result.unresolved[0]?.reason).toBe("unsafe_local_asset");
  const duplicate = await resolveLegacyAgendaHeadshots(
    { speakers: [{ name: "Alex" }, { name: "Alex" }] },
    { ...options, localHeadshotFiles: { "speakers/alex.*": mapping } },
  );
  expect(duplicate.assets).toEqual([]);
  expect(duplicate.unresolved.map((finding) => finding.reason)).toEqual([
    "ambiguous_authored_speaker",
    "ambiguous_authored_speaker",
  ]);
});
