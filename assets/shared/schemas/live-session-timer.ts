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
 * - `session`: counts down the session's length, by itself with the agenda
 *   (see `followsAgenda`) or as an operator starts it;
 * - `until`: counts down to a time on the event's clock;
 * - `duration`: counts down a fixed length;
 * - `stopwatch`: counts up from zero;
 * - `clock`: shows the time of day on the event's clock, and counts nothing.
 */
export const LIVE_TIMER_KINDS = ["session", "until", "duration", "stopwatch", "clock"] as const;
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
  .number({ error: "Enter the length as m:ss or h:mm:ss." })
  .int()
  .min(1, "Enter a length of at least a second.")
  .max(LIVE_TIMER_MAX_MS / 1000, "Keep the length under ten years.");

/**
 * What a countdown does at zero: keep counting as overtime, stop at zero, or
 * (a `duration` only) reset to its full length once it has been over for
 * `resetAfterSeconds`, waiting there or starting again at once.
 */
export const LIVE_TIMER_ZERO_ACTIONS = ["overtime", "stop", "reset"] as const;
export type LiveTimerZeroAction = (typeof LIVE_TIMER_ZERO_ACTIONS)[number];
export const liveTimerAtZeroSchema = z
  .object({
    action: z.enum(LIVE_TIMER_ZERO_ACTIONS),
    resetAfterSeconds: z
      .number({ error: "Enter the seconds over before it resets." })
      .int()
      .min(0, "Enter zero or more seconds.")
      .max(600, "Keep it under ten minutes."),
    restart: z.boolean(),
  })
  .strict();

/**
 * A timer's sounds: a chime with `warningSeconds` left (none when null) and,
 * when `zero` is on, a buzzer at zero. They play on the feeds that show the
 * timer (Program and the livestream, the stage display, a projector, a
 * screen), only while they show it.
 */
const soundFieldsSchema = z
  .object({
    warningSeconds: z
      .number({ error: "Enter the seconds left for the warning." })
      .int()
      .min(1, "Enter at least a second.")
      .max(3600, "Keep the warning under an hour.")
      .nullable(),
    zero: z.boolean(),
  })
  .strict();
/** A timer saved with a list of places to sound in: one that had none stays silent. */
export const liveTimerSoundSchema = z.preprocess((sound) => {
  if (!sound || typeof sound !== "object" || !("places" in sound)) return sound;
  const { places, ...rest } = sound as { places: unknown } & Record<string, unknown>;
  return Array.isArray(places) && places.length ? rest : { ...rest, warningSeconds: null, zero: false };
}, soundFieldsSchema);

export const DEFAULT_LIVE_TIMER_AT_ZERO: z.infer<typeof liveTimerAtZeroSchema> = {
  action: "overtime",
  resetAfterSeconds: 10,
  restart: false,
};
/** Silent until an operator turns the chime or the buzzer on. */
export const DEFAULT_LIVE_TIMER_SOUND: z.infer<typeof liveTimerSoundSchema> = {
  warningSeconds: null,
  zero: false,
};

/** A timer's settings an operator changes after adding it. */
export const liveTimerSettingsSchema = z
  .object({ atZero: liveTimerAtZeroSchema, sound: liveTimerSoundSchema })
  .strict();
export type LiveTimerSettings = z.infer<typeof liveTimerSettingsSchema>;

/** The kinds that can reset themselves at zero: only a fixed length has a length to go back to. */
export const liveTimerResetsAtZero = (kind: LiveTimerKind) => kind === "duration";

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
    /**
     * A session timer that follows the agenda: before the session starts it
     * shows the time until it does, then counts the session down to its end.
     * It reads the session's times, so it keeps no anchor of its own.
     */
    followsAgenda: z.boolean().default(false),
    atZero: liveTimerAtZeroSchema.default(DEFAULT_LIVE_TIMER_AT_ZERO),
    sound: liveTimerSoundSchema.default(DEFAULT_LIVE_TIMER_SOUND),
    change: liveChangeSchema.nullable(),
  })
  .strict()
  .refine((timer) => timer.running === (timer.anchorAt !== null), "A running timer has an anchor; a paused one none.")
  .refine((timer) => !timer.followsAgenda || (timer.kind === "session" && !timer.running), {
    message: "Only a session timer follows the agenda, and it keeps no anchor while it does.",
  })
  .refine((timer) => timer.atZero.action !== "reset" || liveTimerResetsAtZero(timer.kind), {
    message: "Only a timer with a fixed length resets itself at zero.",
  });
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

/**
 * `clock` grows with the time it shows (12:34, 1:02:34, 3d 04:12, 2y 145d)
 * and reads the same in the studio and on every screen; `ss` is total seconds.
 */
export const LIVE_TIMER_FORMATS = ["clock", "ss", "custom"] as const;
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
    format: "clock",
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

/** A timer's name and what it counts, changed after adding it: a length for a countdown, a time for a countdown to a time. */
export const liveTimerEditSchema = z
  .object({
    name: liveTimerNameSchema.optional(),
    durationSeconds: durationSecondsSchema.optional(),
    targetAt: utcInstantSchema.optional(),
  })
  .strict()
  .refine((edit) => Object.keys(edit).length > 0, "Change the name, the length or the time.");
export type LiveTimerEdit = z.infer<typeof liveTimerEditSchema>;

export const liveTimerAddSchema = z.object({ type: z.literal("timer.add"), timer: liveTimerDraftSchema }).strict();
/** `reset`: back to its full length, stopped (an `until` counts to its time again); `follow`: a session timer follows the agenda again. */
export const liveTimerActionSchema = z.enum(["start", "pause", "reset", "follow"]);
export type LiveTimerAction = z.infer<typeof liveTimerActionSchema>;
export const liveTimerCommandSchemas = [
  liveTimerAddSchema,
  z.object({ type: z.literal("timer.remove"), timerId: liveTimerIdSchema }).strict(),
  z.object({ type: z.literal("timer.control"), timerId: liveTimerIdSchema, action: liveTimerActionSchema }).strict(),
  z
    .object({ type: z.literal("timer.configure"), timerId: liveTimerIdSchema, settings: liveTimerSettingsSchema })
    .strict(),
  z.object({ type: z.literal("timer.edit"), timerId: liveTimerIdSchema, edit: liveTimerEditSchema }).strict(),
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
