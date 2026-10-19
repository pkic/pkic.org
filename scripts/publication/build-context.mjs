import { resolve } from "node:path";

export function publicationEnvironment() {
  const branch = process.env.WORKERS_CI_BRANCH;
  const environment =
    process.env.CLOUDFLARE_ENV ?? (branch ? (branch.toLowerCase() === "main" ? "production" : "preview") : "local");
  if (!["local", "preview", "production"].includes(environment)) throw new Error("Invalid publication environment");
  return environment;
}

/** Previews are a mode of the production Worker: wrangler.jsonc declares their
 * preview-only bindings in env.production.previews, not in a separate env. */
export function wranglerEnvironment(target = publicationEnvironment()) {
  if (!["local", "preview", "production"].includes(target)) throw new Error("Invalid publication environment");
  return target === "local" ? "local" : "production";
}

/** Generated site outputs live in the checkout unless a run selects its own root,
 * as the Worker test fixture does so concurrent runs never replace each other's files. */
export function publicationOutputRoot() {
  return resolve(process.env.PKIC_PUBLICATION_OUTPUT_ROOT ?? ".");
}

/** The prepared static assets the Worker serves. */
export function publicAssetsDirectory() {
  return resolve(publicationOutputRoot(), "public");
}

/** Astro's complete static publication before it is merged into the public assets. */
export function astroOutputDirectory() {
  return resolve(publicationOutputRoot(), "dist", "astro");
}

export function publicationStagingDirectory() {
  const id = process.env.PKIC_PUBLICATION_BUILD_ID;
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("Publication requires an isolated build identifier");
  return resolve(publicationOutputRoot(), ".cache", "publication", publicationEnvironment(), id);
}

/** Derived by the owned build from the immutable repair request, never visitor input. */
export function publicationForceRebuild() {
  const value = process.env.PKIC_PUBLICATION_FORCE_REBUILD;
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid publication force-rebuild flag");
}

/** A local-only switch: preview and production builds refuse it rather than ignore it. */
function localPublicationOption(name, enabledValue) {
  const value = process.env[name];
  if (value === undefined) return false;
  if (value !== enabledValue) throw new Error(`Invalid ${name} value`);
  if (publicationEnvironment() !== "local") throw new Error(`${name} applies only to a local publication`);
  return true;
}

/**
 * A fast local publication for testing the portal and event pages: images keep their
 * original files instead of responsive AVIF and WebP variants, inline SVG is not optimized,
 * and social cards are omitted. Diagrams use the normal cached renderer in every mode.
 */
export function publicationFastLocalBuild() {
  return localPublicationOption("PKIC_PUBLICATION_FAST", "1");
}

/**
 * A local rehearsal restores a database backup without its R2 uploads. Approved images
 * whose objects are absent then publish as missing instead of failing the build.
 */
export function publicationOmitsMissingR2Media() {
  return localPublicationOption("PKIC_PUBLICATION_MISSING_R2_MEDIA", "omit");
}

/** Workers Builds currently restores .next/cache but drops the documented Astro cache.
 * Use Astro's native cacheDir in that retained directory; local builds keep the default,
 * and an isolated run may select its own cache root. */
export function publicationCacheRoot() {
  if (process.env.PKIC_PUBLICATION_CACHE_ROOT) return resolve(process.env.PKIC_PUBLICATION_CACHE_ROOT);
  return resolve(process.env.WORKERS_CI_BRANCH ? ".next/cache/astro" : "node_modules/.astro");
}

/** A fast build keeps its own cache, so its pages and images never enter a complete build. */
export function publicationCacheDirectory(...segments) {
  const environment = publicationEnvironment();
  const cache = publicationFastLocalBuild() ? `${environment}-fast` : environment;
  return resolve(publicationCacheRoot(), "publication", cache, ...segments);
}
