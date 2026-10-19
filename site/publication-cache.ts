import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { publicationEnvironment, publicationStagingDirectory } from "../scripts/publication/build-context.mjs";
import { publicImageFile } from "../scripts/publication/public-image-source.mjs";

export const PUBLICATION_SITE_ORIGIN = "https://pkic.org";

export type PublicationImageInputs =
  { cacheable: true; images: { source: string; sha256: string }[] } | { cacheable: false };

const imageDigests = new Map<string, string>();

/** Exact image bytes determine native dimensions and transformed URLs even when
 * the public source URL is unchanged. Unknown image dependencies render in full. */
export function publicationImageInputs(sources: readonly string[]): PublicationImageInputs {
  const images: { source: string; sha256: string }[] = [];
  if (sources.length === 0) return { cacheable: true, images };
  try {
    const directory = resolve(publicationStagingDirectory(), "public");
    for (const source of sources) {
      const file = publicImageFile(source, directory, { allowSvg: true });
      if (!file) return { cacheable: false };
      const parts = relative(directory, file).split(sep);
      for (let index = 0; index < parts.length; index++) {
        const info = lstatSync(resolve(directory, ...parts.slice(0, index + 1)));
        if (info.isSymbolicLink() || (index === parts.length - 1 ? !info.isFile() : !info.isDirectory()))
          return { cacheable: false };
      }
      let sha256 = imageDigests.get(file);
      if (!sha256) {
        sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
        imageDigests.set(file, sha256);
      }
      images.push({ source, sha256 });
    }
    return { cacheable: true, images };
  } catch {
    return { cacheable: false };
  }
}

function canonicalPublicInputs(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object" || ancestors.has(value)) throw new Error("Page cache inputs must be plain JSON");
  const next = new Set(ancestors).add(value);
  if (Array.isArray(value)) return `[${value.map((entry: unknown) => canonicalPublicInputs(entry, next)).join(",")}]`;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw new Error("Page cache inputs must be plain JSON");
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalPublicInputs(entry, next)}`)
    .join(",")}}`;
}

let middlewareDigest: string | undefined;
function publicationMiddlewareDigest(): string {
  if (middlewareDigest !== undefined) return middlewareDigest;
  const digest = createHash("sha256");
  // Middleware presence disables incremental generation in the config; this
  // entry fingerprint is additional input, not a transitive dependency claim.
  for (const path of ["site/middleware.ts", "site/middleware.js", "site/middleware.mjs"]) {
    digest.update(path);
    try {
      digest.update(readFileSync(resolve(path)));
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      digest.update("absent");
    }
  }
  middlewareDigest = digest.digest("hex");
  return middlewareDigest;
}

/** Build-only inputs must be the exact public props consumed by this route.
 * HTML callers include their shared layout projection; ICS/data callers omit it.
 * Unknown dependencies require omitting cacheKey, rather than guessing inputs.
 * Astro independently checks compiled source, configuration and lockfile hashes. */
export function publicationRouteCacheKey(route: string, publicInputs: unknown): string {
  if (!route.startsWith("/") || /[\\?#]/.test(route) || [...route].some((character) => character.charCodeAt(0) < 32))
    throw new Error("Invalid page cache route");
  const environment = publicationEnvironment();
  return createHash("sha256")
    .update(
      canonicalPublicInputs({
        version: 1,
        route,
        environment,
        origin: PUBLICATION_SITE_ORIGIN,
        middleware: publicationMiddlewareDigest(),
        inputs: publicInputs,
      }),
    )
    .digest("hex");
}
