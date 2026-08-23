import type { Env } from "../types";
import { readBoundedStream } from "../utils/bounded-stream";
import { SUPPORTED_RASTER_IMAGE_CONTENT_TYPES, validateRasterImage } from "../utils/image-format";
import { resolveHeroImageSource } from "../utils/hero-image-url";

export { resolveHeroImageSource } from "../utils/hero-image-url";

type StaticAssetEnv = Pick<Env, "ASSETS" | "ASSETS_PUBLIC">;
type HeroImageEnv = Pick<Env, "ASSETS" | "ASSETS_PUBLIC" | "HERO_IMAGE_ALLOWED_HOSTS" | "IMAGES">;

function getAssetBinding(env: StaticAssetEnv): Env["ASSETS"] | undefined {
  return env.ASSETS ?? env.ASSETS_PUBLIC;
}

export async function fetchStaticAsset(
  env: StaticAssetEnv,
  origin: string,
  path: string,
  signal?: AbortSignal,
): Promise<Response> {
  const request = new Request(new URL(path, origin).toString(), signal ? { signal } : undefined);
  const binding = getAssetBinding(env);
  return binding ? binding.fetch(request) : fetch(request);
}

/** Fast Uint8Array to base64 without quadratic string reallocation. */
export function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export const MAX_HERO_IMAGE_BYTES = 5 * 1024 * 1024;
export const HERO_IMAGE_FETCH_TIMEOUT_MS = 5_000;
const HERO_IMAGE_CONTENT_TYPES = new Set<string>(SUPPORTED_RASTER_IMAGE_CONTENT_TYPES);

/** Buffers only a small, explicitly supported image response for SVG embedding. */
export async function imageResponseToDataUrl(
  response: Response,
  maxBytes = MAX_HERO_IMAGE_BYTES,
): Promise<string | null> {
  if (!response.ok || !response.body) return null;
  const mime = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (!HERO_IMAGE_CONTENT_TYPES.has(mime)) return null;

  const declaredLength = response.headers.get("content-length");
  if (declaredLength) {
    if (!/^\d+$/.test(declaredLength)) return null;
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength > maxBytes) return null;
  }

  const result = await readBoundedStream(response.body, maxBytes, "Hero image exceeds the byte limit");
  if (!result.ok) return null;
  const bytes = result.bytes;
  const validation = validateRasterImage(bytes);
  if (!validation.ok || validation.image.contentType !== mime) return null;
  return `data:${validation.image.contentType};base64,${uint8ToBase64(bytes)}`;
}

function extractHeroImageUrl(settingsJson: string): string | null {
  try {
    const settings = JSON.parse(settingsJson) as Record<string, unknown>;
    return typeof settings.heroImageUrl === "string" && settings.heroImageUrl ? settings.heroImageUrl : null;
  } catch {
    return null;
  }
}

export async function fetchHeroImage(
  settingsJson: string,
  origin: string,
  env: HeroImageEnv,
  timeoutMs = HERO_IMAGE_FETCH_TIMEOUT_MS,
): Promise<string | null> {
  const raw = extractHeroImageUrl(settingsJson);
  if (!raw) return null;
  const source = resolveHeroImageSource(raw, origin, env.HERO_IMAGE_ALLOWED_HOSTS);
  if (!source) return null;

  try {
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    if (source.assetPath) {
      response = await fetchStaticAsset(env, origin, source.assetPath, signal);
      if (!response.ok) return null;
      if (env.IMAGES && response.body) {
        const transformed = await env.IMAGES.input(response.body)
          .transform({ width: 1200, height: 630, fit: "cover" })
          .output({ format: "jpeg", quality: 95 });
        response = await transformed.response();
      }
    } else {
      const requestInit: RequestInit & { cf: { image: Record<string, string | number> } } = {
        signal,
        redirect: "manual",
        cf: { image: { width: 1200, height: 630, fit: "cover", format: "jpeg", quality: 95 } },
      };
      response = await fetch(source.url, requestInit);
    }
    return imageResponseToDataUrl(response);
  } catch {
    return null;
  }
}
