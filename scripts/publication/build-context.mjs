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

export function publicationStagingDirectory() {
  const id = process.env.PKIC_PUBLICATION_BUILD_ID;
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("Publication requires an isolated build identifier");
  return resolve(".cache", "publication", publicationEnvironment(), id);
}

/** Workers Builds currently restores .next/cache but drops the documented Astro cache.
 * Use Astro's native cacheDir in that retained directory; local builds keep the default. */
export function publicationCacheDirectory(...segments) {
  const directory = process.env.WORKERS_CI_BRANCH ? ".next/cache/astro" : "node_modules/.astro";
  return resolve(directory, ...segments);
}
