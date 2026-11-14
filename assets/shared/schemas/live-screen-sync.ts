import { z } from "zod";
import { LIVE_STUDIO_AUX_OUTPUTS } from "../live-room-outputs";

/**
 * Whether each of the room's screens follows Program: shows what is live,
 * plus whatever an operator put on that screen itself. On by default, so a
 * screen nobody touched shows the live question, poll and timers. Turned
 * off, a screen shows only what was put on it. The room keeps one copy.
 */

export const liveSyncedScreenSchema = z.enum(LIVE_STUDIO_AUX_OUTPUTS);
export type LiveSyncedScreen = z.infer<typeof liveSyncedScreenSchema>;

export const liveScreenSyncSchema = z
  .object({ projector: z.boolean(), "stage-display": z.boolean() })
  .strict() satisfies z.ZodType<Record<LiveSyncedScreen, boolean>>;
export type LiveScreenSync = z.infer<typeof liveScreenSyncSchema>;

export const DEFAULT_LIVE_SCREEN_SYNC: LiveScreenSync = { projector: true, "stage-display": true };

/** The room snapshot's copy, the defaults until an operator changes one. */
export const liveScreenSyncSnapshotSchema = liveScreenSyncSchema.default(DEFAULT_LIVE_SCREEN_SYNC);

/** One screen at a time, so two operators flipping different screens never undo each other. */
export const liveScreenSyncCommandSchema = z
  .object({ type: z.literal("screen.sync"), output: liveSyncedScreenSchema, sync: z.boolean() })
  .strict();

export const liveScreenSyncChangedSchema = z
  .object({ type: z.literal("screen.sync.changed"), screenSync: liveScreenSyncSchema })
  .strict();
