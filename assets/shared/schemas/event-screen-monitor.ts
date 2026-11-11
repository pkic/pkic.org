import { z } from "zod";
import { eventSlugParamsSchema, utcInstantSchema } from "./api-common";
import { screenIdSchema, screenOutputSchema } from "./event-screens";

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
  const picked: Record<string, ScreenMetricValue> = {};
  for (const group of SCREEN_DEVICE_METRICS_GROUPS) {
    const value = prune((raw as Record<string, unknown>)[group], 0);
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
export const SCREEN_PLAYER_STATUSES = ["loading", "playing", "buffering", "error"] as const;

export const screenHealthSchema = z
  .object({
    /** The page's build, so staff see a screen still running an old release. */
    pageVersion: z.string().min(1).max(120),
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
    health: screenHealthSchema.nullable(),
  })
  .strict();
export type ScreenLiveStatus = z.infer<typeof screenLiveStatusSchema>;

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

/** Monitor to screen: a manager's command. */
export const screenMonitorCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("screen.identify"), until: utcInstantSchema }).strict(),
  z.object({ type: z.literal("screen.reload") }).strict(),
]);
export type ScreenMonitorCommand = z.infer<typeof screenMonitorCommandSchema>;

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

/** Monitor to staff. */
export const screenMonitorServerMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("screens.snapshot"),
      /** The viewer may send Identify and Reload. */
      control: z.boolean(),
      screens: z.array(screenLiveStatusSchema).max(SCREEN_MONITOR_LIMITS.screensPerEvent),
    })
    .strict(),
  z
    .object({
      type: z.literal("screens.changed"),
      screen: screenLiveStatusSchema,
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
