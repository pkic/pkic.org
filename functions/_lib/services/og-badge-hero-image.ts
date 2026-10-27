import { bytesToBase64 as uint8ToBase64 } from "../../../assets/shared/base64";
export { bytesToBase64 as uint8ToBase64 } from "../../../assets/shared/base64";
import { resolveHeroImageUrl } from "./event-presentation";
import type { Env } from "../types";
import { readBoundedStream } from "../utils/bounded-stream";
import {
  SUPPORTED_RASTER_IMAGE_CONTENT_TYPES,
  validateRasterImage,
  type EmbeddedRasterImage,
  type ValidatedRasterImage,
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
// Images accepts sources up to 20 MB; only the compact, validated result enters the SVG.
export const MAX_HERO_IMAGE_SOURCE_BYTES = 20 * 1024 * 1024;
export const HERO_IMAGE_FETCH_TIMEOUT_MS = 5_000;
const HERO_IMAGE_CONTENT_TYPES = new Set<string>(SUPPORTED_RASTER_IMAGE_CONTENT_TYPES);

interface HeroImageSourceBytes {
  bytes: Uint8Array<ArrayBuffer>;
  image: ValidatedRasterImage;
}

function embeddedImage({ bytes, image }: HeroImageSourceBytes): EmbeddedRasterImage {
  return { ...image, dataUrl: `data:${image.contentType};base64,${uint8ToBase64(bytes)}` };
}

/** Bound encoded bytes and decoded dimensions before conversion or SVG embedding. */
async function readHeroImageResponse(
  response: Response,
  maxBytes = MAX_HERO_IMAGE_BYTES,
): Promise<HeroImageSourceBytes | null> {
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
  return { bytes, image: validation.image };
}

export async function imageResponseToDataUrl(
  response: Response,
  maxBytes = MAX_HERO_IMAGE_BYTES,
): Promise<string | null> {
  const image = await readHeroImageResponse(response, maxBytes);
  return image ? embeddedImage(image).dataUrl : null;
}

export async function fetchHeroImage(
  settingsJson: string,
  origin: string,
  env: HeroImageEnv,
  timeoutMs = HERO_IMAGE_FETCH_TIMEOUT_MS,
): Promise<EmbeddedRasterImage | null> {
  const raw = resolveHeroImageUrl({ settings_json: settingsJson });
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
    const original = await readHeroImageResponse(
      response,
      env.IMAGES ? MAX_HERO_IMAGE_SOURCE_BYTES : MAX_HERO_IMAGE_BYTES,
    );
    if (!original) return null;
    if (original.image.contentType !== "image/webp" && original.bytes.byteLength <= MAX_HERO_IMAGE_BYTES)
      return embeddedImage(original);
    // Keep the original aspect ratio: only the scene's final cover operation crops the photo.
    if (!env.IMAGES) return null;
    const normalized = await env.IMAGES.input(new Response(original.bytes).body!)
      .transform({})
      .output({ format: "image/jpeg", quality: 95 });
    const compact = await readHeroImageResponse(await normalized.response());
    return compact ? embeddedImage(compact) : null;
  } catch {
    return null;
  }
}
