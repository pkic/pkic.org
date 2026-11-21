import { z } from "zod";
import { LIVE_PRESENCE_TARGETS } from "../live-room-presence";
import { liveAuxOutputSchema } from "./live-session-stage";
import { livePersonNameSchema } from "./live-session-change";

/**
 * Operator presence in a live room: which control each operator is on and
 * where they point on a shared monitor. Never stored; the room fans it out
 * to the other operators only.
 */

/** A control id fragment: a panel kind or an item such as `lowerThird:user:…` or `question:<id>`. */
const livePresenceTokenSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:._-]*$/);
/** The control an operator hovers or focuses, by stable id rather than by screen position. */
export const livePresenceFocusSchema = z
  .object({
    panel: livePresenceTokenSchema,
    item: livePresenceTokenSchema.nullable(),
    target: z.enum(LIVE_PRESENCE_TARGETS).nullable(),
  })
  .strict();
export type LivePresenceFocus = z.infer<typeof livePresenceFocusSchema>;
/** The monitors a pointer can rest on: every composition the room draws, not the livestream video. */
export const livePresenceOutputSchema = z.union([z.enum(["preview", "program"]), liveAuxOutputSchema]);
export type LivePresenceOutput = z.infer<typeof livePresenceOutputSchema>;
/** Where an operator points on a shared monitor, in 0–1 coordinates of its 16:9 composition. */
export const livePresencePointerSchema = z
  .object({
    output: livePresenceOutputSchema,
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();
export type LivePresencePointer = z.infer<typeof livePresencePointerSchema>;
/** One other operator's presence as the room fans it out. */
export const livePresenceSchema = z
  .object({
    id: z.string().regex(/^[0-9a-f]{8}$/),
    name: livePersonNameSchema,
    focus: livePresenceFocusSchema.nullable(),
    pointer: livePresencePointerSchema.nullable(),
    /** The operator just changed the focused control. */
    changed: z.boolean(),
  })
  .strict();
export type LivePresence = z.infer<typeof livePresenceSchema>;
export const livePresenceUpdateSchema = z
  .object({
    type: z.literal("presence.update"),
    focus: livePresenceFocusSchema.nullable(),
    pointer: livePresencePointerSchema.nullable(),
    changed: z.boolean(),
  })
  .strict();
export type LivePresenceUpdate = z.infer<typeof livePresenceUpdateSchema>;
