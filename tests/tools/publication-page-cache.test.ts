import { localSnapshotReceiptPath } from "../../scripts/publication/local-snapshot-receipt.mjs";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { publicationImageInputs, publicationRouteCacheKey } from "../../site/publication-cache";
import { publicationForceRebuild, publicationStagingDirectory } from "../../scripts/publication/build-context.mjs";
import {
  sealPublicationPageCache,
  publicationSupportsPageCache,
  discardPublicationPageCache,
  validatePublicationPageCache,
} from "../../scripts/publication/validate-page-cache.mjs";
import { createTemporaryDirectory } from "./helpers/temporary-directory";

afterEach(() => vi.unstubAllEnvs());

it("uses full rendering when middleware could introduce untracked transitive dependencies", async () => {
  const directory = await createTemporaryDirectory("publication-page-cache-");
  try {
    expect(publicationSupportsPageCache(directory)).toBe(true);
    await mkdir(resolve(directory, "middleware"));
    await writeFile(resolve(directory, "middleware/index.ts"), "import './external-policy';");
    expect(publicationSupportsPageCache(directory)).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function nativeCacheFixture(directory: string) {
  await mkdir(resolve(directory, "dist/events/synthetic/agenda"), { recursive: true });
  await mkdir(resolve(directory, "assets"), { recursive: true });
  await writeFile(resolve(directory, "dist/events/synthetic/agenda/index.html"), "<h1>Approved synthetic agenda</h1>");
  await writeFile(resolve(directory, "assets/synthetic.webp"), "synthetic image bytes");
  // The installed native Astro manifest owns route dependency hashes and raw
  // output paths. This fixture tests our byte guard, not a replacement renderer.
  await writeFile(
    resolve(directory, "incremental-build.json"),
    JSON.stringify({
      version: 1,
      configHash: "synthetic-config",
      lockfileHash: "synthetic-lock",
      keyDigest: null,
      routes: {
        "site/pages/[...eventAgenda].astro": {
          dependencyHash: "synthetic-compiled-dependencies",
          paths: {
            "/events/synthetic/agenda/": {
              cacheKey: publicationRouteCacheKey("/events/synthetic/agenda/", { title: "Approved synthetic agenda" }),
              outputFile: "events/synthetic/agenda/index.html",
              staticImages: [
                {
                  originalPath: "/_assets/synthetic.png",
                  hash: "synthetic-image-hash",
                  finalPath: "/_assets/synthetic.webp",
                  transform: { src: { src: "/_assets/synthetic.png" } },
                },
              ],
            },
          },
        },
      },
    }),
  );
}

it("keys the exact consumed public data deterministically, with independent route/environment inputs", () => {
  vi.stubEnv("CLOUDFLARE_ENV", "local");
  const route = "/events/synthetic/agenda/";
  const original = publicationRouteCacheKey(route, { title: "Approved", credits: ["Speaker"], missing: undefined });
  expect(publicationRouteCacheKey(route, { credits: ["Speaker"], title: "Approved" })).toBe(original);
  expect(publicationRouteCacheKey(route, { credits: ["Speaker"], title: "Changed" })).not.toBe(original);
  expect(publicationRouteCacheKey("/events/unrelated/agenda/", { title: "Approved", credits: ["Speaker"] })).not.toBe(
    original,
  );
  vi.stubEnv("CLOUDFLARE_ENV", "preview");
  expect(publicationRouteCacheKey(route, { title: "Approved", credits: ["Speaker"] })).not.toBe(original);
  expect(() => publicationRouteCacheKey(route, { now: new Date() })).toThrow("plain JSON");
  expect(() => publicationRouteCacheKey(route, { number: Number.NaN })).toThrow("plain JSON");
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  expect(() => publicationRouteCacheKey(route, cycle)).toThrow("plain JSON");
  vi.stubEnv("CLOUDFLARE_ENV", undefined);
  vi.stubEnv("WORKERS_CI_BRANCH", "main");
  const derived = publicationRouteCacheKey(route, { title: "Approved" });
  vi.stubEnv("CLOUDFLARE_ENV", "production");
  expect(publicationRouteCacheKey(route, { title: "Approved" })).toBe(derived);
});

it("keys exact same-URL image bytes from each fresh build and refuses unknown dependencies", async () => {
  vi.stubEnv("CLOUDFLARE_ENV", "local");
  const staging: string[] = [];
  const results = [];
  try {
    for (const bytes of ["<svg width='32'/>", "<svg width='64'/>"]) {
      vi.stubEnv("PKIC_PUBLICATION_BUILD_ID", randomUUID());
      const directory = publicationStagingDirectory();
      staging.push(directory);
      await mkdir(resolve(directory, "public/images"), { recursive: true });
      await writeFile(resolve(directory, "public/images/synthetic.svg"), bytes);
      results.push(publicationImageInputs(["/images/synthetic.svg"]));
      expect(publicationImageInputs(["/images/synthetic.svg"])).toEqual(results.at(-1));
      expect(publicationImageInputs(["https://outside.example/logo.svg"])).toEqual({ cacheable: false });
      expect(publicationImageInputs(["/images/missing.svg"])).toEqual({ cacheable: false });
      await symlink(resolve(directory, "public/images/synthetic.svg"), resolve(directory, "public/images/symlink.svg"));
      expect(publicationImageInputs(["/images/symlink.svg"])).toEqual({ cacheable: false });
    }
    expect(results[0]).toMatchObject({ cacheable: true, images: [{ source: "/images/synthetic.svg" }] });
    expect(results[1]).not.toEqual(results[0]);
  } finally {
    for (const directory of staging) await rm(directory, { recursive: true, force: true });
  }
});

it("force repairs discard native optimization bytes and seal only newly completed generation", async () => {
  const directory = await createTemporaryDirectory("publication-page-cache-");
  try {
    vi.stubEnv("PKIC_PUBLICATION_FORCE_REBUILD", "1");
    expect(publicationForceRebuild()).toBe(true);
    vi.stubEnv("PKIC_PUBLICATION_FORCE_REBUILD", "0");
    expect(publicationForceRebuild()).toBe(false);
    vi.stubEnv("PKIC_PUBLICATION_FORCE_REBUILD", "true");
    expect(() => publicationForceRebuild()).toThrow("Invalid publication force-rebuild flag");
    await nativeCacheFixture(directory);
    await sealPublicationPageCache(directory, directory);
    await discardPublicationPageCache(directory, directory);
    await expect(readFile(resolve(directory, "publication-page-cache.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(sealPublicationPageCache(directory, directory)).rejects.toMatchObject({ code: "ENOENT" });
    await nativeCacheFixture(directory);
    await sealPublicationPageCache(directory, directory);
    await expect(validatePublicationPageCache(directory, directory)).resolves.toEqual({ verified: true, paths: 1 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("verifies completed native cache bytes and falls back cold after a raw-page change", async () => {
  const directory = await createTemporaryDirectory("publication-page-cache-");
  try {
    await nativeCacheFixture(directory);
    await sealPublicationPageCache(directory, directory);
    await expect(validatePublicationPageCache(directory, directory)).resolves.toEqual({ verified: true, paths: 1 });
    await mkdir(resolve(directory, "publication-social"));
    await writeFile(resolve(directory, "publication-social/unrelated.jpg"), "independently keyed OG cache");
    await writeFile(resolve(directory, "dist/events/synthetic/agenda/index.html"), "stale or injected bytes");
    await expect(validatePublicationPageCache(directory, directory)).resolves.toEqual({ verified: false, paths: 0 });
    await expect(readFile(resolve(directory, "incremental-build.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(resolve(directory, "publication-social/unrelated.jpg"), "utf8")).resolves.toBe(
      "independently keyed OG cache",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("rejects incomplete builds, altered images and removed raw outputs before native reuse", async () => {
  const directory = await createTemporaryDirectory("publication-page-cache-");
  try {
    await nativeCacheFixture(directory);
    await expect(validatePublicationPageCache(directory, directory)).resolves.toEqual({ verified: false, paths: 0 });
    await nativeCacheFixture(directory);
    await sealPublicationPageCache(directory, directory);
    await writeFile(resolve(directory, "assets/synthetic.webp"), "changed image");
    await expect(validatePublicationPageCache(directory, directory)).resolves.toEqual({ verified: false, paths: 0 });
    await nativeCacheFixture(directory);
    await sealPublicationPageCache(directory, directory);
    await rm(resolve(directory, "dist/events/synthetic/agenda/index.html"));
    await expect(validatePublicationPageCache(directory, directory)).resolves.toEqual({ verified: false, paths: 0 });
    await nativeCacheFixture(directory);
    await rm(resolve(directory, "assets/synthetic.webp"));
    await expect(sealPublicationPageCache(directory, directory)).rejects.toThrow(
      "Missing native page cache image transform",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("refuses cache symlink ownership and never changes an external file", async () => {
  const directory = await createTemporaryDirectory("publication-page-cache-");
  const outside = await createTemporaryDirectory("publication-page-cache-outside-");
  try {
    await writeFile(resolve(outside, "preserved.txt"), "external");
    await symlink(outside, resolve(directory, "redirected"), "dir");
    await expect(validatePublicationPageCache(resolve(directory, "redirected"), directory)).rejects.toThrow(
      "Unsafe publication page cache",
    );
    await nativeCacheFixture(directory);
    await sealPublicationPageCache(directory, directory);
    await symlink(resolve(outside, "preserved.txt"), resolve(directory, "dist/injected.html"));
    await expect(validatePublicationPageCache(directory, directory)).resolves.toEqual({ verified: false, paths: 0 });
    await expect(readFile(resolve(outside, "preserved.txt"), "utf8")).resolves.toBe("external");
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

it("refuses intermediate owned cache symlinks before creation or cleanup outside the anchor", async () => {
  const anchor = await createTemporaryDirectory("publication-page-cache-anchor-");
  const outside = await createTemporaryDirectory("publication-page-cache-outside-");
  try {
    const owned = resolve(anchor, ".next/cache/astro");
    await mkdir(owned, { recursive: true });
    await symlink(outside, resolve(owned, "publication"), "dir");
    const existing = resolve(outside, "local");
    await nativeCacheFixture(existing);
    await writeFile(resolve(existing, "preserved.txt"), "outside sentinel");
    for (const operation of [validatePublicationPageCache, discardPublicationPageCache, sealPublicationPageCache]) {
      await expect(operation(resolve(owned, "publication/local"), anchor)).rejects.toThrow(
        "Unsafe publication page cache directory",
      );
      await expect(operation(resolve(owned, "publication/not-created"), anchor)).rejects.toThrow(
        "Unsafe publication page cache directory",
      );
      await expect(operation(outside, anchor)).rejects.toThrow("outside its trusted anchor");
    }
    await expect(readFile(resolve(existing, "preserved.txt"), "utf8")).resolves.toBe("outside sentinel");
    await expect(readFile(resolve(existing, "dist/events/synthetic/agenda/index.html"), "utf8")).resolves.toBe(
      "<h1>Approved synthetic agenda</h1>",
    );
    await expect(readFile(resolve(existing, "assets/synthetic.webp"), "utf8")).resolves.toBe("synthetic image bytes");
    await expect(readFile(resolve(existing, "incremental-build.json"), "utf8")).resolves.toContain("synthetic-config");
    await expect(readFile(resolve(outside, "not-created"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(anchor, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

it("supports the intentional node_modules anchor symlink while checking each cache component below it", async () => {
  const parent = await createTemporaryDirectory("publication-page-cache-parent-");
  const canonicalAnchor = await createTemporaryDirectory("publication-page-cache-canonical-");
  try {
    const anchor = resolve(parent, "node_modules");
    await symlink(canonicalAnchor, anchor, "dir");
    const directory = resolve(anchor, ".astro/publication/local");
    await expect(validatePublicationPageCache(directory, anchor)).resolves.toEqual({ verified: false, paths: 0 });
    await nativeCacheFixture(directory);
    await sealPublicationPageCache(directory, anchor);
    await expect(validatePublicationPageCache(directory, anchor)).resolves.toEqual({ verified: true, paths: 1 });
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(canonicalAnchor, { recursive: true, force: true });
  }
});

it("keeps local snapshot receipts outside every public input, output, and staging tree", async () => {
  const root = resolve(process.env.PKIC_TEST_TEMP_ROOT ?? tmpdir(), `publication-receipt-${randomUUID()}`);
  const names = ["output", "public", "static", "content", "staging"];
  try {
    const protectedTrees = names.map((name) => resolve(root, name));
    for (const tree of [...protectedTrees, resolve(root, "private")]) await mkdir(tree, { recursive: true });
    const receipt = resolve(root, "private/snapshot.json");
    expect(await localSnapshotReceiptPath(receipt, "local", protectedTrees)).toBe(receipt);
    expect(await localSnapshotReceiptPath(undefined, "production", protectedTrees)).toBeUndefined();
    await expect(localSnapshotReceiptPath(receipt, "preview", protectedTrees)).rejects.toThrow("local-only");
    for (const tree of protectedTrees) {
      await expect(localSnapshotReceiptPath(resolve(tree, "snapshot.json"), "local", protectedTrees)).rejects.toThrow(
        "outside",
      );
    }
    await symlink(resolve(root, "public"), resolve(root, "alias"));
    await expect(
      localSnapshotReceiptPath(resolve(root, "alias/snapshot.json"), "local", protectedTrees),
    ).rejects.toThrow("outside");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
