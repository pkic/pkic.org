/**
 * A browser screen's screenshot: one frame of its own tab, scaled to the
 * width a device's screenshot has and encoded as WebP, or as JPEG where the
 * browser cannot encode WebP. Sent like a device's screenshot, or not at all.
 */
import { SCREEN_MONITOR_LIMITS } from "../../shared/schemas/event-screen-monitor";

export const BROWSER_SCREEN_FRAME = {
  /** As wide as a device's screenshot. */
  width: 640,
  quality: 0.6,
  /** One more try when a frame comes out over the size limit. */
  retryQuality: 0.4,
} as const;

/** The part of a canvas the encoder needs. */
export interface FrameCanvas {
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
}

const blobOf = (canvas: FrameCanvas, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** WebP where the browser encodes it (its blob says so), JPEG otherwise. */
async function encodeAt(canvas: FrameCanvas, quality: number): Promise<Blob | null> {
  const webp = await blobOf(canvas, "image/webp", quality);
  if (webp?.type === "image/webp") return webp;
  const jpeg = await blobOf(canvas, "image/jpeg", quality);
  return jpeg?.type === "image/jpeg" ? jpeg : null;
}

/** The frame's bytes within the limit, at the usual quality or once more at a lower one; null otherwise. */
export async function encodeBrowserScreenFrame(canvas: FrameCanvas): Promise<ArrayBuffer | null> {
  for (const quality of [BROWSER_SCREEN_FRAME.quality, BROWSER_SCREEN_FRAME.retryQuality]) {
    const blob = await encodeAt(canvas, quality);
    if (!blob) return null;
    if (blob.size <= SCREEN_MONITOR_LIMITS.screenshotBytes) return blob.arrayBuffer();
  }
  return null;
}

/** The frame's size at the screenshot width, keeping its shape; null before the capture has a picture. */
export function browserScreenFrameSize(video: { videoWidth: number; videoHeight: number }) {
  if (!video.videoWidth || !video.videoHeight) return null;
  const width = Math.min(BROWSER_SCREEN_FRAME.width, video.videoWidth);
  return { width, height: Math.max(1, Math.round((video.videoHeight * width) / video.videoWidth)) };
}
