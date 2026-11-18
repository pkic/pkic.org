import { z } from "zod";
import { LIVE_AUX_OUTPUTS } from "../live-room-outputs";

/**
 * How many read-only sources draw each output of a room now: a browser
 * source in the streaming software, or a screen in the room. Operators only,
 * so the studio can tell a feed that dropped from one that is connected.
 */

export const LIVE_SOURCE_OUTPUTS = ["program", ...LIVE_AUX_OUTPUTS] as const;
export type LiveSourceOutput = (typeof LIVE_SOURCE_OUTPUTS)[number];

const count = z.number().int().nonnegative().max(10_000);

export const liveRoomSourcesSchema = z
  .object({ program: count, projector: count, "stage-preview": count, "stage-display": count })
  .strict() satisfies z.ZodType<Record<LiveSourceOutput, number>>;
export type LiveRoomSources = z.infer<typeof liveRoomSourcesSchema>;

export const NO_LIVE_ROOM_SOURCES: LiveRoomSources = {
  program: 0,
  projector: 0,
  "stage-preview": 0,
  "stage-display": 0,
};

/** The room snapshot's copy: zeros for everyone but operators. */
export const liveRoomSourcesSnapshotSchema = liveRoomSourcesSchema.default(NO_LIVE_ROOM_SOURCES);

export const liveRoomSourcesChangedSchema = z
  .object({ type: z.literal("sources.changed"), sources: liveRoomSourcesSchema })
  .strict();
