import { z } from "zod";
import { LIVE_HELD_OUTPUTS_MAX, liveAuxOutputSchema } from "./live-session-stage";

/**
 * How many read-only sources draw each output of a room now: a browser
 * source in the streaming software, or a screen in the room. Operators only,
 * so the studio can tell a feed that dropped from one that is connected.
 */

/** Program, or one of the room's outputs by its key. */
export type LiveSourceOutput = string;

const count = z.number().int().nonnegative().max(10_000);

/** Sources by output; an output no source draws now is left out. */
export const liveRoomSourcesSchema = z
  .record(z.union([z.literal("program"), liveAuxOutputSchema]), count)
  .refine((sources) => Object.keys(sources).length <= LIVE_HELD_OUTPUTS_MAX + 1, "Too many outputs.");
export type LiveRoomSources = z.infer<typeof liveRoomSourcesSchema>;

export const NO_LIVE_ROOM_SOURCES: LiveRoomSources = {};

/** The room snapshot's copy: zeros for everyone but operators. */
export const liveRoomSourcesSnapshotSchema = liveRoomSourcesSchema.default(NO_LIVE_ROOM_SOURCES);

export const liveRoomSourcesChangedSchema = z
  .object({ type: z.literal("sources.changed"), sources: liveRoomSourcesSchema })
  .strict();
