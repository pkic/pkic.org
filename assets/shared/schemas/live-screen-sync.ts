import { z } from "zod";
import { liveRoomOutputKeySchema } from "./live-room-output-setup";

/**
 * Whether each of the room's screens follows Program: every change of
 * Program also changes that screen, in the screen's own scene. On by
 * default, so a screen nobody touched shows what is live. Turned off, a
 * screen stays as it is until an operator changes it. The speaker's screen
 * shows Program's question and timers beside its own while on (see
 * live-screen-sync). The room keeps one copy.
 */

export const liveSyncedScreenSchema = liveRoomOutputKeySchema;
export type LiveSyncedScreen = z.infer<typeof liveSyncedScreenSchema>;

/** At most one entry per output a room can hold, with room for outputs it removed since. */
const SYNC_ENTRIES_MAX = 16;
/** An output an operator never switched follows Program as its role says (see live-screen-sync). */
export const liveScreenSyncSchema = z
  .record(liveSyncedScreenSchema, z.boolean())
  .refine((sync) => Object.keys(sync).length <= SYNC_ENTRIES_MAX, "Too many outputs.");
export type LiveScreenSync = z.infer<typeof liveScreenSyncSchema>;

export const DEFAULT_LIVE_SCREEN_SYNC: LiveScreenSync = {};

/** The room snapshot's copy, the defaults until an operator changes one. */
export const liveScreenSyncSnapshotSchema = liveScreenSyncSchema.default(DEFAULT_LIVE_SCREEN_SYNC);

/** One screen at a time, so two operators flipping different screens never undo each other. */
export const liveScreenSyncCommandSchema = z
  .object({ type: z.literal("screen.sync"), output: liveSyncedScreenSchema, sync: z.boolean() })
  .strict();

export const liveScreenSyncChangedSchema = z
  .object({ type: z.literal("screen.sync.changed"), screenSync: liveScreenSyncSchema })
  .strict();
