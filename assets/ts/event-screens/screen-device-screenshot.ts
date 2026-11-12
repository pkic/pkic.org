/**
 * The device's own screenshot of what the screen shows, read from its local
 * service like its metrics: a small WebP the device refreshes every few
 * seconds. The page sends it to the monitor as it is, or not at all. Only a
 * device screen reads it; a browser screen never touches the local address.
 */
import { SCREEN_MONITOR_LIMITS, screenScreenshotFormat } from "../../shared/schemas/event-screen-monitor";

/** The device's local screenshot; the screen page's policy allows this origin and no other local one. */
export const SCREEN_DEVICE_SCREENSHOT_URL = "http://127.0.0.1:8080/screenshot";
const TIMEOUT_MS = 3_000;

export type ScreenScreenshotReader = () => Promise<ArrayBuffer | null>;

/** Null when the device cannot be reached, has none yet (503), or answers with anything but a small WebP or JPEG. */
export const readScreenDeviceScreenshot: ScreenScreenshotReader = async () => {
  try {
    const response = await fetch(SCREEN_DEVICE_SCREENSHOT_URL, {
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (!response.ok || declared > SCREEN_MONITOR_LIMITS.screenshotBytes) {
      await response.body?.cancel();
      return null;
    }
    const bytes = await response.arrayBuffer();
    return screenScreenshotFormat(new Uint8Array(bytes)) ? bytes : null;
  } catch {
    return null;
  }
};
