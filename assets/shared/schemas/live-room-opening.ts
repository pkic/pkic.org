import { z } from "zod";

/**
 * Whether attendees may take part in a session's room: chat, reactions,
 * questions and poll answers. On schedule, the agenda decides (see
 * live-session-policy); an operator may open the room now, to test it or to
 * let a discussion run on, or close it now. The choice holds until an
 * operator changes it. Operators always take part. The room keeps one copy.
 */
export const liveRoomOpeningSchema = z.enum(["scheduled", "open", "closed"]);
export type LiveRoomOpening = z.infer<typeof liveRoomOpeningSchema>;

export const DEFAULT_LIVE_ROOM_OPENING: LiveRoomOpening = "scheduled";

/** The room snapshot's copy, on schedule until an operator changes it. */
export const liveRoomOpeningSnapshotSchema = liveRoomOpeningSchema.default(DEFAULT_LIVE_ROOM_OPENING);

export const liveRoomOpeningCommandSchema = z
  .object({ type: z.literal("room.opening"), opening: liveRoomOpeningSchema })
  .strict();

export const liveRoomOpeningChangedSchema = z
  .object({ type: z.literal("room.opening.changed"), opening: liveRoomOpeningSchema })
  .strict();
