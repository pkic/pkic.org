import { bytesToBase64 as uint8ToBase64 } from "../../../assets/shared/base64";
export { bytesToBase64 as uint8ToBase64 } from "../../../assets/shared/base64";
import type { Env } from "../types";
import { readBoundedStream } from "../utils/bounded-stream";
import {
  SUPPORTED_RASTER_IMAGE_CONTENT_TYPES,
  validateRasterImage,
  type EmbeddedRasterImage,
} from "../utils/image-format";
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

export const MAX_HERO_IMAGE_BYTES = 5 * 1024 * 1024;
export const HERO_IMAGE_FETCH_TIMEOUT_MS = 5_000;
const HERO_IMAGE_CONTENT_TYPES = new Set<string>(SUPPORTED_RASTER_IMAGE_CONTENT_TYPES);

/** Buffers only a small, explicitly supported image response for SVG embedding. */
async function readHeroImageResponse(
  response: Response,
  maxBytes = MAX_HERO_IMAGE_BYTES,
): Promise<EmbeddedRasterImage | null> {
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
  return { ...validation.image, dataUrl: `data:${validation.image.contentType};base64,${uint8ToBase64(bytes)}` };
}

export async function imageResponseToDataUrl(
  response: Response,
  maxBytes = MAX_HERO_IMAGE_BYTES,
): Promise<string | null> {
  return (await readHeroImageResponse(response, maxBytes))?.dataUrl ?? null;
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
): Promise<EmbeddedRasterImage | null> {
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
    } else {
      const requestInit: RequestInit = { signal, redirect: "manual" };
      response = await fetch(source.url, requestInit);
    }
    const original = await readHeroImageResponse(response);
    if (!original || original.contentType !== "image/webp") return original;
    // The SVG rasterizer cannot decode WebP. Normalize the format without a resize or crop.
    if (!env.IMAGES) return null;
    const bytes = Uint8Array.from(atob(original.dataUrl.slice(original.dataUrl.indexOf(",") + 1)), (character) =>
      character.charCodeAt(0),
    );
    const normalized = await env.IMAGES.input(new Response(bytes).body!)
      .transform({})
      .output({ format: "jpeg", quality: 95 });
    return readHeroImageResponse(await normalized.response());
  } catch {
    return null;
  }
}
