import { lstat, readdir, readFile, writeFile, rename, rm, mkdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { z } from "zod";
import { createReleaseIntegrity } from "./release-integrity.mjs";
import {
  sitePublicationIntegrityPathSchema,
  sitePublicationIntegritySchema,
  publicationIntegrityHashInput,
} from "../../assets/shared/schemas/site-publication-release.ts";

const manifestPath = "incremental-build.json";
const sealPath = "publication-page-cache.json";
const outputDirectories = ["dist", "assets"];

/** Astro does not invalidate imported middleware dependencies for incremental
 * builds. Until it does, sites using middleware conservatively render in full. */
export function publicationSupportsPageCache(sourceDirectory) {
  return !["ts", "js", "mjs", "cjs", "tsx", "jsx"].some(
    (extension) =>
      existsSync(resolve(sourceDirectory, `middleware.${extension}`)) ||
      existsSync(resolve(sourceDirectory, "middleware", `index.${extension}`)),
  );
}
const manifestSchema = z.object({
  version: z.literal(1),
  configHash: z.string(),
  lockfileHash: z.string(),
  routes: z.record(
    z.string(),
    z.object({
      dependencyHash: z.string(),
      paths: z.record(
        z.string(),
        z.object({
          outputFile: sitePublicationIntegrityPathSchema,
          cacheKey: z.string(),
          staticImages: z.array(z.object({ finalPath: z.string() })).optional(),
        }),
      ),
    }),
  ),
});

function publicationCacheAnchor() {
  return resolve(process.env.WORKERS_CI_BRANCH ? "." : "node_modules");
}

async function ensureCacheRoot(directory, anchorDirectory) {
  const path = relative(resolve(anchorDirectory), resolve(directory));
  if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`))
    throw new Error("Publication page cache is outside its trusted anchor");
  // Only the configured anchor may resolve through nonowned ancestors, including
  // the repository's deliberate node_modules symlink and system temporary roots.
  const anchor = await realpath(anchorDirectory);
  let current = anchor;
  for (const part of path ? path.split(sep) : []) {
    current = resolve(current, part);
    try {
      await lstat(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      try {
        await mkdir(current);
      } catch (creationError) {
        if (creationError.code !== "EEXIST") throw creationError;
      }
    }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe publication page cache directory");
  }
  // Standalone test caches may use their existing root as the explicit anchor;
  // a final root symlink must still refuse rather than silently trust its target.
  const info = await lstat(path ? current : directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe publication page cache directory");
  return { directory: current, anchorDirectory: anchor };
}

async function collectCacheFiles(directory, path, files) {
  sitePublicationIntegrityPathSchema.parse(path);
  let info;
  try {
    info = await lstat(resolve(directory, path));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (info.isSymbolicLink()) throw new Error("Publication page cache contains a symlink");
  if (info.isDirectory()) {
    for (const entry of await readdir(resolve(directory, path)))
      await collectCacheFiles(directory, `${path}/${entry}`, files);
  } else if (info.isFile()) files.add(path);
  else throw new Error("Publication page cache contains an unsupported file");
  if (files.size > 100_000) throw new Error("Publication page cache exceeds its inventory bound");
}

async function inspectCache(directory) {
  const info = await lstat(resolve(directory, manifestPath));
  if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024)
    throw new Error("Invalid native page cache manifest");
  const manifest = manifestSchema.parse(JSON.parse(await readFile(resolve(directory, manifestPath), "utf8")));
  const files = new Set([manifestPath]);
  for (const path of outputDirectories) await collectCacheFiles(directory, path, files);
  let paths = 0;
  for (const entry of Object.values(manifest.routes)) {
    for (const path of Object.values(entry.paths)) {
      if (!files.has(`dist/${path.outputFile}`)) throw new Error("Missing native page cache output");
      for (const image of path.staticImages ?? []) {
        sitePublicationIntegrityPathSchema.parse(image.finalPath.replace(/^\//, ""));
        if (!files.has(`assets/${basename(image.finalPath)}`))
          throw new Error("Missing native page cache image transform");
      }
      if (++paths > 100_000) throw new Error("Native page cache exceeds its route bound");
    }
  }
  return { paths, integrity: await createReleaseIntegrity(directory, [...files]) };
}

/** Discard only native optimization bytes before a forced full repair. */
export async function discardPublicationPageCache(directory, anchorDirectory = publicationCacheAnchor()) {
  ({ directory } = await ensureCacheRoot(directory, anchorDirectory));
  for (const path of [manifestPath, sealPath, ...outputDirectories])
    await rm(resolve(directory, path), { recursive: true, force: true });
}

/** Existing Astro caches are an optimization, never an approval or serving source.
 * Corrupt, missing or unfinished caches fall back to complete native rendering. */
export async function validatePublicationPageCache(directory, anchorDirectory = publicationCacheAnchor()) {
  ({ directory, anchorDirectory } = await ensureCacheRoot(directory, anchorDirectory));
  try {
    const info = await lstat(resolve(directory, sealPath));
    if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024)
      throw new Error("Invalid publication page cache seal");
    const expected = sitePublicationIntegritySchema.parse(
      JSON.parse(await readFile(resolve(directory, sealPath), "utf8")),
    );
    const actual = await inspectCache(directory);
    if (
      expected.digest !== actual.integrity.digest ||
      publicationIntegrityHashInput(expected.files) !== publicationIntegrityHashInput(actual.integrity.files)
    )
      throw new Error("Publication page cache bytes changed");
    console.log(`[publication] verified native page cache: ${actual.paths} keyed paths`);
    return { verified: true, paths: actual.paths };
  } catch (error) {
    await discardPublicationPageCache(directory, anchorDirectory);
    console.log(
      `[publication] full page render required: ${error instanceof Error ? error.message : "unavailable cache"}`,
    );
    return { verified: false, paths: 0 };
  }
}

/** Seal only after fresh extraction, complete post-processing and release integrity
 * succeed. A failed build leaves a mismatching prior seal and cannot reuse its work. */
export async function sealPublicationPageCache(directory, anchorDirectory = publicationCacheAnchor()) {
  ({ directory } = await ensureCacheRoot(directory, anchorDirectory));
  const { paths, integrity } = await inspectCache(directory);
  const temporary = resolve(directory, `${sealPath}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(integrity), { flag: "wx" });
    await rename(temporary, resolve(directory, sealPath));
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(`[publication] sealed native page cache: ${paths} keyed paths`);
}
