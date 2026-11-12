/**
 * The device's own metrics, read from its local status service when the
 * browser lets the page reach it. The page forwards only what
 * `screenDeviceMetricsFrom` keeps; anything else, the device's management
 * secret above all, never leaves the device.
 */
import { screenDeviceMetricsFrom, type ScreenDeviceMetrics } from "../../shared/schemas/event-screen-monitor";

/** The device's local metrics service; the screen page's policy allows this origin and no other local one. */
export const SCREEN_DEVICE_METRICS_URL = "http://127.0.0.1:8080/metrics";
/** A larger answer is not the device's metrics. */
const MAX_RESPONSE_BYTES = 65_536;
const TIMEOUT_MS = 2_000;

export type ScreenMetricsReader = () => Promise<ScreenDeviceMetrics | null>;

/** Null when the device cannot be reached, answers too slowly, or answers something else. */
export const readScreenDeviceMetrics: ScreenMetricsReader = async () => {
  try {
    const response = await fetch(SCREEN_DEVICE_METRICS_URL, {
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) return null;
    return screenDeviceMetricsFrom(JSON.parse(text));
  } catch {
    return null;
  }
};
