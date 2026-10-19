import { AppError } from "../errors";

/**
 * How stored images are cached. An image is addressed by the file it is, so
 * a new upload gets a new address and an address never changes what it
 * shows: browsers and the edge can keep it for a year without asking again,
 * and a page renders from cache instead of reaching the Worker per render.
 *
 * - Brand images (organization and sponsor logos) are public: a versioned
 *   address is cached a year everywhere.
 * - A person's portrait is public too, but must stop being served promptly
 *   once removed or replaced: browsers keep it, the shared edge rechecks it
 *   every five minutes, and that recheck is a cheap 304 against its entity tag.
 * - An image only staff may see is never stored by a shared cache.
 */
export const IMMUTABLE_BRAND_IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const PERSON_PORTRAIT_CACHE_CONTROL = "public, max-age=31536000, s-maxage=300, immutable";
export const PRIVATE_IMAGE_CACHE_CONTROL = "private, no-store";

/** The version a stored image's address carries: its storage file name, which every upload makes new. */
export function storedImageVersion(key: string): string {
  return (key.split("/").pop() ?? key).replace(/[^A-Za-z0-9._-]/g, "_").slice(-120) || "image";
}

/** The image's address at its current version, so caches may keep it; null when there is no image. */
export function versionedImagePath(path: string, key: string | null | undefined): string | null {
  return key ? `${path}?v=${encodeURIComponent(storedImageVersion(key))}` : null;
}

/**
 * Checks the version an address asked for against the image stored now. A
 * stale version no longer resolves, exactly like a replaced portrait's file
 * address, so no cache is ever handed old bytes under a current address.
 */
export function assertImageVersion(key: string, requested: string | undefined): void {
  if (requested !== undefined && requested !== storedImageVersion(key))
    throw new AppError(404, "NOT_FOUND", "This version of the image is no longer available.");
}

/** A strong validator for one image file, or one rendition of it. */
export function imageEntityTag(version: string, variant?: string): string {
  return `"${variant ? `${version}-${variant}` : version}"`;
}

/**
 * Answers a revalidation without reading the image: the caller has already
 * checked that the file is still the current one, so a matching tag means the
 * cached bytes are still right.
 */
export function notModifiedImage(request: Request, entityTag: string, cacheControl: string): Response | null {
  const tags = (request.headers.get("if-none-match") ?? "").split(",").map((tag) => tag.trim().replace(/^W\//, ""));
  if (!tags.includes(entityTag) && !tags.includes("*")) return null;
  return new Response(null, { status: 304, headers: { ETag: entityTag, "Cache-Control": cacheControl } });
}

/** The served image with its validator. */
export function withImageEntityTag(response: Response, entityTag: string): Response {
  response.headers.set("ETag", entityTag);
  return response;
}
