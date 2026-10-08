import { resolve } from "node:path";

export function publicationEnvironment() {
  const branch = process.env.WORKERS_CI_BRANCH;
  const environment =
    process.env.CLOUDFLARE_ENV ?? (branch ? (branch.toLowerCase() === "main" ? "production" : "preview") : "local");
  if (!["local", "preview", "production"].includes(environment)) throw new Error("Invalid publication environment");
  return environment;
}

export function publicationStagingDirectory() {
  const id = process.env.PKIC_PUBLICATION_BUILD_ID;
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("Publication requires an isolated build identifier");
  return resolve(".cache", "publication", publicationEnvironment(), id);
}

/** Derived by the owned build from the immutable repair request, never visitor input. */
export function publicationForceRebuild() {
  const value = process.env.PKIC_PUBLICATION_FORCE_REBUILD;
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid publication force-rebuild flag");
}

/** Workers Builds currently restores .next/cache but drops the documented Astro cache.
 * Use Astro's native cacheDir in that retained directory; local builds keep the default. */
export function publicationCacheDirectory(...segments) {
  const directory = process.env.WORKERS_CI_BRANCH ? ".next/cache/astro" : "node_modules/.astro";
  return resolve(directory, "publication", publicationEnvironment(), ...segments);
}
