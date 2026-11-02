import type { Env } from "../types";

export interface EncodedImage {
  bytes: Uint8Array;
  contentType: string;
}

export interface RenderedImageOutput {
  format: "image/jpeg" | "image/webp";
  quality: number;
  fit?: number;
}

/** Badges are shared and attached to email at full size, so they keep a high quality. */
export const BADGE_IMAGE_OUTPUT: RenderedImageOutput = { format: "image/jpeg", quality: 95 };
/** Gallery previews: a frame is at most 11rem wide, so 480px covers a 2x screen. */
export const THUMBNAIL_OUTPUT: RenderedImageOutput = { format: "image/webp", quality: 80, fit: 480 };

/**
 * Re-encodes a rendered PNG through the Cloudflare Images binding, optionally
 * scaled down to fit a square of `fit` pixels. Without the binding (some local
 * setups) the PNG is kept as it is, so callers store whatever type comes back.
 */
export async function encodeRenderedPng(
  env: Pick<Env, "IMAGES">,
  png: Uint8Array,
  output: RenderedImageOutput,
): Promise<EncodedImage> {
  if (!env.IMAGES) return { bytes: png, contentType: "image/png" };
  const result = await env.IMAGES.input(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(png);
        controller.close();
      },
    }),
  )
    .transform(output.fit ? { width: output.fit, height: output.fit, fit: "scale-down" } : {})
    .output({ format: output.format, quality: output.quality });
  return { bytes: new Uint8Array(await (await result.response()).arrayBuffer()), contentType: output.format };
}
