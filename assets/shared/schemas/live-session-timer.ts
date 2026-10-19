import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { validateOverlayTextTemplate } from "../overlay-text-template";
import { liveChangeSchema } from "./live-session-change";

/**
 * A room's timers and the timer graphic. A room keeps several named timers;
 * each output that shows a timer names which one and how it looks. Instants
 * are UTC; the control room and the outputs show them on the event's clock.
 */

/**
 * - `session`: counts down to the session's scheduled end on the agenda;
 * - `until`: counts down to a time on the event's clock;
 * - `duration`: counts down a fixed length;
 * - `stopwatch`: counts up from zero.
 */
export const LIVE_TIMER_KINDS = ["session", "until", "duration", "stopwatch"] as const;
export type LiveTimerKind = (typeof LIVE_TIMER_KINDS)[number];
export const LIVE_TIMER_MAX = 12;
/** Ten fixed 365-day years either way, including long-form custom durations. */
export const LIVE_TIMER_MAX_MS = 10 * 365 * 24 * 60 * 60 * 1000;

export const liveTimerIdSchema = z.string().regex(/^[a-z0-9-]{1,40}$/u);
export const liveTimerNameSchema = z
  .string()
  .trim()
  .min(1, "Name the timer.")
  .max(40, "Keep the name under 40 characters.");
const durationSecondsSchema = z
  .number({ error: "Enter the length in minutes." })
  .int()
  .min(1, "Enter a length of at least a minute.")
  .max(LIVE_TIMER_MAX_MS / 1000, "Keep the length under ten years.");

export const liveTimerSchema = z
  .object({
    id: liveTimerIdSchema,
    name: liveTimerNameSchema,
    kind: z.enum(LIVE_TIMER_KINDS),
    /** An `until` timer's end. */
    targetAt: utcInstantSchema.nullable(),
    /** A countdown's full length, for its progress: a `duration`'s length, an `until`'s span when added. */
    durationSeconds: durationSecondsSchema.nullable(),
    running: z.boolean(),
    /** While running: when a countdown reaches zero, or when a stopwatch would have read zero. */
    anchorAt: utcInstantSchema.nullable(),
    /** While paused: a countdown's time left (negative once over), or a stopwatch's time counted. */
    heldMs: z.number().int().min(-LIVE_TIMER_MAX_MS).max(LIVE_TIMER_MAX_MS),
    change: liveChangeSchema.nullable(),
  })
  .strict()
  .refine((timer) => timer.running === (timer.anchorAt !== null), "A running timer has an anchor; a paused one none.");
export type LiveTimer = z.infer<typeof liveTimerSchema>;
export const liveTimersSchema = z.array(liveTimerSchema).max(LIVE_TIMER_MAX);

/** What an operator fills in to add a timer; the room gives it an id and starts it as its kind does. */
export const liveTimerDraftSchema = z
  .object({
    name: liveTimerNameSchema,
    kind: z.enum(LIVE_TIMER_KINDS),
    targetAt: utcInstantSchema.nullable(),
    durationSeconds: durationSecondsSchema.nullable(),
  })
  .strict()
  .superRefine((draft, context) => {
    if (draft.kind === "until" && draft.targetAt === null)
      context.addIssue({ code: "custom", path: ["targetAt"], message: "Enter the time it counts down to." });
    if (draft.kind === "duration" && draft.durationSeconds === null)
      context.addIssue({ code: "custom", path: ["durationSeconds"], message: "Enter the length in minutes." });
  });
export type LiveTimerDraft = z.infer<typeof liveTimerDraftSchema>;

// ── The timer graphic ───────────────────────────────────────────────────────

export const LIVE_TIMER_FORMATS = ["hh:mm:ss", "mm:ss", "ss", "custom"] as const;
/** Time left on a countdown, or time gone since it started. A stopwatch always counts up. */
export const LIVE_TIMER_DIRECTIONS = ["remaining", "elapsed"] as const;
/** Where the graphic sits: the source's layout, a corner, or the middle of the picture. */
export const LIVE_TIMER_PLACEMENTS = [
  "layout",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center",
] as const;
export const LIVE_TIMER_SIZES = ["small", "medium", "large"] as const;
export const LIVE_TIMER_PRESENTATIONS = ["ring", "digital"] as const;

export const liveTimerGraphicSchema = z
  .object({
    timerId: liveTimerIdSchema,
    /** Null shows the timer's own name. */
    label: z.string().trim().min(1).max(40, "Keep the label under 40 characters.").nullable(),
    showLabel: z.boolean(),
    format: z.enum(LIVE_TIMER_FORMATS),
    customFormat: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .refine((value) => validateOverlayTextTemplate(value) === null, "Use a valid duration template.")
      .default("{{hours}}h {{minutes}}m {{seconds}}s"),
    showLogo: z.boolean().default(true),
    direction: z.enum(LIVE_TIMER_DIRECTIONS),
    /** The graphic turns to its warning color with this much time left. */
    warningSeconds: z
      .number({ error: "Enter the warning in seconds." })
      .int()
      .min(0, "Enter zero or more seconds.")
      .max(3600, "Keep the warning under an hour."),
    /** Once over time, the graphic turns to its overrun color this long after zero. */
    overrunSeconds: z
      .number({ error: "Enter the overrun in seconds." })
      .int()
      .min(0, "Enter zero or more seconds.")
      .max(3600, "Keep the overrun under an hour."),
    presentation: z.enum(LIVE_TIMER_PRESENTATIONS),
    placement: z.enum(LIVE_TIMER_PLACEMENTS),
    size: z.enum(LIVE_TIMER_SIZES),
  })
  .strict();
export const liveTimerGraphicsSchema = z
  .array(liveTimerGraphicSchema)
  .max(LIVE_TIMER_MAX)
  .refine(
    (graphics) => new Set(graphics.map((graphic) => graphic.timerId)).size === graphics.length,
    "Show each timer once per output.",
  );
export type LiveTimerGraphic = z.infer<typeof liveTimerGraphicSchema>;

export function defaultLiveTimerGraphic(timerId: string): LiveTimerGraphic {
  return {
    timerId,
    label: null,
    showLabel: true,
    format: "mm:ss",
    customFormat: "{{hours}}h {{minutes}}m {{seconds}}s",
    showLogo: true,
    direction: "remaining",
    warningSeconds: 120,
    overrunSeconds: 0,
    presentation: "ring",
    placement: "layout",
    size: "large",
  };
}

// ── Commands ────────────────────────────────────────────────────────────────

export const liveTimerAddSchema = z.object({ type: z.literal("timer.add"), timer: liveTimerDraftSchema }).strict();
export const liveTimerActionSchema = z.enum(["start", "pause", "reset"]);
export const liveTimerCommandSchemas = [
  liveTimerAddSchema,
  z.object({ type: z.literal("timer.remove"), timerId: liveTimerIdSchema }).strict(),
  z.object({ type: z.literal("timer.control"), timerId: liveTimerIdSchema, action: liveTimerActionSchema }).strict(),
  z
    .object({
      type: z.literal("timer.adjust"),
      timerId: liveTimerIdSchema,
      deltaSeconds: z
        .number()
        .int()
        .min(-3600)
        .max(3600)
        .refine((value) => value !== 0),
    })
    .strict(),
  /** Shows a timer graphic on Program, or takes it off. */
  z.object({ type: z.literal("stage.timer"), timer: liveTimerGraphicSchema, visible: z.boolean() }).strict(),
] as const;
export const liveTimersChangedSchema = z
  .object({ type: z.literal("timers.changed"), timers: liveTimersSchema })
  .strict();
