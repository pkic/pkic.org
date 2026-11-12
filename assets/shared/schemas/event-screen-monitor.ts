import { z } from "zod";
import { eventSlugParamsSchema, utcInstantSchema } from "./api-common";
import { screenIdSchema, screenOutputSchema } from "./event-screens";
import { detectImageFormat } from "../image-signature";

/**
 * The event's screen monitor: each paired screen keeps a socket open to its
 * event's monitor and reports its health; staff who manage or operate the
 * event's screens watch those reports live, and screen managers send a
 * screen Identify or Reload through it. Nothing here touches the database
 * per message: the monitor rechecks access on its own schedule.
 */
export const SCREEN_MONITOR_PROTOCOL = "pkic-screens.v1";

export const SCREEN_MONITOR_LIMITS = {
  /** The largest message either side accepts. */
  messageBytes: 16_384,
  /** The device's metrics, serialized, after the allowlist and pruning. */
  metricsBytes: 4_096,
  /** Nesting below a metrics group, keys per object, entries per list and characters per text. */
  metricsDepth: 3,
  metricsKeys: 32,
  metricsItems: 16,
  metricsText: 120,
  /** Screens one event's monitor keeps, and the staff connections it holds at once. */
  screensPerEvent: 100,
  staffConnections: 64,
  /** One screen ID may hold this many sockets (a reload overlapping its old page). */
  socketsPerScreen: 2,
  /** The largest screenshot a screen may send, and the monitor keeps: one JPEG per screen. */
  screenshotBytes: 65_536,
  /** Quality samples the monitor keeps per screen: one a minute for the last hour. */
  qualityMinutes: 60,
} as const;

// ── Device metrics ──

/**
 * The device's own metrics groups the screen forwards. Everything else the
 * device reports, its management secret above all, stays on the device.
 */
export const SCREEN_DEVICE_METRICS_GROUPS = ["uptime", "temps", "network", "versions"] as const;

/** Keys whose values a screen never forwards, at any depth. */
const SECRET_KEY = /secret|password|passphrase|token|credential|psk|private|key/i;

export type ScreenMetricValue = string | number | boolean | null | ScreenMetricValue[] | ScreenMetricObject;
export interface ScreenMetricObject {
  [key: string]: ScreenMetricValue;
}

const metricKeySchema = z
  .string()
  .min(1)
  .max(64)
  .refine((key) => !SECRET_KEY.test(key), "Secrets stay on the device.");

const metricValueSchema: z.ZodType<ScreenMetricValue> = z.lazy(() =>
  z.union([
    z.string().max(SCREEN_MONITOR_LIMITS.metricsText),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(metricValueSchema).max(SCREEN_MONITOR_LIMITS.metricsItems),
    z
      .record(metricKeySchema, metricValueSchema)
      .refine((value) => Object.keys(value).length <= SCREEN_MONITOR_LIMITS.metricsKeys, "Too many metrics."),
  ]),
);

function depth(value: ScreenMetricValue): number {
  if (value === null || typeof value !== "object") return 0;
  const children = Array.isArray(value) ? value : Object.values(value);
  return 1 + Math.max(0, ...children.map(depth));
}

const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/** The allowlisted groups of the device's metrics, bounded in depth and size. */
export const screenDeviceMetricsSchema = z
  .object(
    Object.fromEntries(SCREEN_DEVICE_METRICS_GROUPS.map((group) => [group, metricValueSchema.optional()])) as Record<
      (typeof SCREEN_DEVICE_METRICS_GROUPS)[number],
      z.ZodOptional<typeof metricValueSchema>
    >,
  )
  .strict()
  .refine(
    (metrics) =>
      Object.values(metrics).every(
        (value) => value === undefined || depth(value) <= SCREEN_MONITOR_LIMITS.metricsDepth,
      ),
    "Metrics nest too deep.",
  )
  .refine((metrics) => byteLength(metrics) <= SCREEN_MONITOR_LIMITS.metricsBytes, "Metrics are too large.");
export type ScreenDeviceMetrics = z.infer<typeof screenDeviceMetricsSchema>;

function prune(value: unknown, level: number): ScreenMetricValue | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.slice(0, SCREEN_MONITOR_LIMITS.metricsText);
  if (typeof value !== "object" || level >= SCREEN_MONITOR_LIMITS.metricsDepth) return undefined;
  if (Array.isArray(value))
    return value
      .slice(0, SCREEN_MONITOR_LIMITS.metricsItems)
      .map((item) => prune(item, level + 1))
      .filter((item): item is ScreenMetricValue => item !== undefined);
  const kept: ScreenMetricObject = {};
  for (const [key, child] of Object.entries(value).slice(0, SCREEN_MONITOR_LIMITS.metricsKeys)) {
    if (!metricKeySchema.safeParse(key).success) continue;
    const pruned = prune(child, level + 1);
    if (pruned !== undefined) kept[key] = pruned;
  }
  return kept;
}

/**
 * What a screen forwards of whatever its device reports: the allowlisted
 * groups only, secrets dropped, cut to the limits. Null when nothing is left
 * or the result is still too large.
 */
export function screenDeviceMetricsFrom(raw: unknown): ScreenDeviceMetrics | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const picked: Record<string, ScreenMetricValue> = {};
  for (const group of SCREEN_DEVICE_METRICS_GROUPS) {
    // The device's agent reports its uptime in seconds as `uptime_s`.
    const value = prune(group === "uptime" ? (source.uptime ?? source.uptime_s) : source[group], 0);
    if (value !== undefined) picked[group] = value;
  }
  if (!Object.keys(picked).length) return null;
  const parsed = screenDeviceMetricsSchema.safeParse(picked);
  return parsed.success ? parsed.data : null;
}

// ── A screen's health ──

/** What the screen draws, as `screenDisplay` decides it. */
export const SCREEN_DISPLAY_KINDS = ["pairing", "waiting", "livestream", "idle", "output"] as const;
/** Following the studio, holding its last state while the studio is out of reach, or running on its agenda. */
export const SCREEN_RUN_MODES = ["live", "offline", "auto"] as const;
/**
 * What runs the screen page: the venue's screen device, which marks its own
 * address, or any other browser set up as a screen (a laptop at a stage).
 */
export const SCREEN_KINDS = ["device", "browser"] as const;
export type ScreenKind = (typeof SCREEN_KINDS)[number];
/** A browser screen's tab capture: running, ended by the person sharing it, or not started since the page loaded. */
export const SCREEN_BROWSER_CAPTURE_STATES = ["live", "stopped", "off"] as const;

/**
 * A browser screen's livestream sound, as its player confirms it: playing
 * unmuted, blocked by the browser (muted, or not playing at all), still
 * starting, or no player to have sound.
 */
export const SCREEN_BROWSER_SOUND_STATES = ["on", "blocked", "starting", "none"] as const;

/**
 * What a browser screen was granted by the clicks that set it up, which a
 * reload takes away. A device screen has none of this.
 */
export const screenBrowserStateSchema = z
  .object({
    fullscreen: z.boolean(),
    wakeLock: z.boolean(),
    sound: z.enum(SCREEN_BROWSER_SOUND_STATES),
    capture: z.enum(SCREEN_BROWSER_CAPTURE_STATES),
  })
  .strict();
export type ScreenBrowserState = z.infer<typeof screenBrowserStateSchema>;
export const SCREEN_PLAYER_STATUSES = ["loading", "playing", "buffering", "error"] as const;
/** The YouTube player's own states, as its IFrame API names them. */
export const LIVESTREAM_PLAYER_STATES = ["unstarted", "ended", "playing", "paused", "buffering", "cued"] as const;

/** Stalls that started in a window, and the seconds of the window spent stalled. */
const stallWindowSchema = z
  .object({
    count: z.number().int().min(0).max(10_000),
    seconds: z.number().min(0).max(3_600),
  })
  .strict();

/**
 * What the YouTube player itself says, sampled at each report. A stall is
 * any time between leaving playing and playing again; the first start is not
 * one. The reported quality is YouTube's own label and is often "auto".
 */
export const screenPlaybackSchema = z
  .object({
    state: z.enum(LIVESTREAM_PLAYER_STATES).nullable(),
    stalls: z
      .object({
        lastMinute: stallWindowSchema,
        lastHour: stallWindowSchema,
        /** Every stall since the page started its player, a count that only grows until the page reloads. */
        started: z.number().int().min(0).max(1_000_000),
      })
      .strict(),
    /** The player's last error code (2, 5, 100, 101, 150), until another video arrives. */
    errorCode: z.number().int().min(0).max(100_000).nullable(),
    /** The share of the video the player has buffered, from 0 to 1. */
    loadedFraction: z.number().min(0).max(1).nullable(),
    reportedQuality: z.string().max(32).nullable(),
    /** How far the player runs behind the live edge, while YouTube says the video is live. */
    liveLagSeconds: z.number().min(0).max(86_400).nullable(),
  })
  .strict();
export type ScreenPlayback = z.infer<typeof screenPlaybackSchema>;

export const screenHealthSchema = z
  .object({
    /** The page's build, so staff see a screen still running an old release. */
    pageVersion: z.string().min(1).max(120),
    /** A page from before screens said what runs them is a device's. */
    kind: z.enum(SCREEN_KINDS).default("device"),
    /** A browser screen's grants; null on a device. */
    browser: screenBrowserStateSchema.nullable().default(null),
    display: z.enum(SCREEN_DISPLAY_KINDS),
    /** The output it is assigned and shows; null while it shows none. */
    output: screenOutputSchema.nullable(),
    mode: z.enum(SCREEN_RUN_MODES),
    /** The livestream player, while one runs. */
    player: z
      .object({
        status: z.enum(SCREEN_PLAYER_STATUSES),
        muted: z.boolean(),
        changedAt: utcInstantSchema,
        /** The player's own readings at the time of the report; null before it is ready. */
        playback: screenPlaybackSchema.nullable(),
      })
      .strict()
      .nullable(),
    /** The server's clock minus the device's, as the screen last measured it. */
    clockOffsetMs: z.number().int().min(-86_400_000).max(86_400_000),
    /** The device's metrics, when the screen could read them. */
    metrics: screenDeviceMetricsSchema.nullable(),
  })
  .strict();
export type ScreenHealth = z.infer<typeof screenHealthSchema>;

/** One screen as the monitor knows it. */
export const screenLiveStatusSchema = z
  .object({
    screenId: screenIdSchema,
    /** A socket of the screen is open now. */
    online: z.boolean(),
    /** When its current connection opened, or its last one closed. */
    connectedAt: utcInstantSchema.nullable(),
    disconnectedAt: utcInstantSchema.nullable(),
    /** When its last health report arrived, on the server's clock. */
    reportedAt: utcInstantSchema.nullable(),
    /** Since when it has drawn what its health says (its mode, display and player status), on the server's clock. */
    stateSince: utcInstantSchema.nullable(),
    health: screenHealthSchema.nullable(),
  })
  .strict();
export type ScreenLiveStatus = z.infer<typeof screenLiveStatusSchema>;

// ── Quality history ──

/**
 * One minute of a screen's connection and playback, the worst of the
 * reports in that minute (the last for throughput). Null where the device or
 * the player did not say.
 */
export const screenQualitySampleSchema = z
  .object({
    /** The start of the minute. */
    minute: utcInstantSchema,
    internetLatencyMs: z.number().min(0).max(60_000).nullable(),
    internetLossPercent: z.number().min(0).max(100).nullable(),
    routerLatencyMs: z.number().min(0).max(60_000).nullable(),
    /** The Wi-Fi signal as the device reports it, from 0 to 100. */
    wifiSignalPercent: z.number().min(0).max(100).nullable(),
    rxBitsPerSecond: z.number().min(0).max(1e12).nullable(),
    livestreamStalls: z.number().int().min(0).max(10_000).nullable(),
  })
  .strict();
export type ScreenQualitySample = z.infer<typeof screenQualitySampleSchema>;

export const screenQualityHistorySchema = z
  .object({
    screenId: screenIdSchema,
    /** Oldest first, at most one per minute. */
    samples: z.array(screenQualitySampleSchema).max(SCREEN_MONITOR_LIMITS.qualityMinutes),
  })
  .strict();
export type ScreenQualityHistory = z.infer<typeof screenQualityHistorySchema>;

// ── Screenshots ──

/** The image formats a screenshot may come in, as the screen's device or browser encodes it. */
export const SCREEN_SCREENSHOT_FORMATS = ["webp", "jpeg"] as const;
export type ScreenScreenshotFormat = (typeof SCREEN_SCREENSHOT_FORMATS)[number];

/**
 * A screen sends its screenshot as one binary message: the image itself, as
 * it was encoded, no larger than the limit. Its format is read from its
 * leading bytes, never from anything declared; anything but WebP or JPEG is
 * dropped.
 */
export function screenScreenshotFormat(bytes: Uint8Array): ScreenScreenshotFormat | null {
  if (bytes.byteLength > SCREEN_MONITOR_LIMITS.screenshotBytes) return null;
  const detected = detectImageFormat(bytes);
  return detected?.contentType === "image/webp" ? "webp" : detected?.contentType === "image/jpeg" ? "jpeg" : null;
}

// ── Messages ──

/** The screen's socket: `GET /api/v1/screens/:screenId/live`, signed in with its own cookie. */
export const screenMonitorScreenParamsSchema = z.object({
  screenId: screenIdSchema,
});
/** Staff's socket: `GET /api/v1/events/:eventSlug/screens/live`. */
export const screenMonitorStaffParamsSchema = eventSlugParamsSchema;

/** Screen to monitor. */
export const screenMonitorScreenMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("screen.health"), health: screenHealthSchema }).strict(),
]);
export type ScreenMonitorScreenMessage = z.infer<typeof screenMonitorScreenMessageSchema>;

/**
 * Monitor to screen: a manager's command, or how often to send a
 * screenshot (more often while staff watch).
 */
export const screenMonitorCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("screen.identify"), until: utcInstantSchema }).strict(),
  z.object({ type: z.literal("screen.reload") }).strict(),
  z.object({ type: z.literal("screen.capture"), everySeconds: z.number().int().min(5).max(3_600) }).strict(),
]);
export type ScreenMonitorCommand = z.infer<typeof screenMonitorCommandSchema>;
/** What a screen manager asks of a screen. */
export type ScreenManagerCommand = Exclude<ScreenMonitorCommand, { type: "screen.capture" }>;

export const SCREEN_MONITOR_COMMANDS = ["screen.identify", "screen.reload"] as const;

/** Staff to monitor: Identify or Reload one screen. Only screen managers may send them. */
export const screenMonitorStaffMessageSchema = z
  .object({
    type: z.enum(SCREEN_MONITOR_COMMANDS),
    screenId: screenIdSchema,
    operationId: z.uuid(),
  })
  .strict();
export type ScreenMonitorStaffMessage = z.infer<typeof screenMonitorStaffMessageSchema>;

/**
 * The monitor's clock when it sent a message, in epoch milliseconds. Staff
 * read every age and staleness against it, never against their own clock,
 * which may be off by minutes.
 */
const serverNowSchema = z.number().int().positive();

/** Monitor to staff. */
export const screenMonitorServerMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("screens.snapshot"),
      serverNow: serverNowSchema,
      /** The viewer may send Identify and Reload. */
      control: z.boolean(),
      screens: z.array(screenLiveStatusSchema).max(SCREEN_MONITOR_LIMITS.screensPerEvent),
      /** Each screen's last hour; the screenshots follow, one message each. */
      quality: z.array(screenQualityHistorySchema).max(SCREEN_MONITOR_LIMITS.screensPerEvent),
    })
    .strict(),
  z
    .object({
      type: z.literal("screens.changed"),
      serverNow: serverNowSchema,
      screen: screenLiveStatusSchema,
      /** With a health report: the screen's sample for the current minute, replacing any of the same minute. */
      sample: screenQualitySampleSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("screens.screenshot"),
      serverNow: serverNowSchema,
      screenId: screenIdSchema,
      /** When the monitor received it. */
      capturedAt: utcInstantSchema,
      format: z.enum(SCREEN_SCREENSHOT_FORMATS),
      /** The image as the screen sent it, base64-encoded. */
      image: z
        .base64()
        .min(4)
        .max(Math.ceil(SCREEN_MONITOR_LIMITS.screenshotBytes / 3) * 4),
    })
    .strict(),
  z
    .object({
      type: z.literal("screens.sent"),
      operationId: z.uuid(),
      screenId: screenIdSchema,
      command: z.enum(SCREEN_MONITOR_COMMANDS),
    })
    .strict(),
  z
    .object({
      type: z.literal("screens.refused"),
      code: z.string().min(1).max(80),
      message: z.string().max(300),
      operationId: z.uuid().optional(),
    })
    .strict(),
]);
export type ScreenMonitorServerMessage = z.infer<typeof screenMonitorServerMessageSchema>;
