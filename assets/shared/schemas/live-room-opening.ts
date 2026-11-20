import { z } from "zod";
import { databaseIdSchema } from "./identifiers";

/**
 * Whether attendees may take part in a session's room: chat, reactions,
 * questions and poll answers. On schedule, the agenda decides (see
 * live-session-policy); an operator may open the room now, to test it or to
 * let a discussion run on, or close it now. The choice holds until an
 * operator changes it, or until the studio loads another session in its
 * physical room, which hands it back to the schedule. Operators always take
 * part. The room keeps one copy.
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

/**
 * Where the studio went on from this session: the session it loaded next in the same physical room, or
 * null when it loaded none. The virtual room follows the studio, so attendees still on this session move
 * there. Null on the snapshot while the studio has not moved on from this session.
 */
export const liveRoomMovedOnSchema = z.object({ occurrenceId: databaseIdSchema.nullable() }).strict();
export type LiveRoomMovedOn = z.infer<typeof liveRoomMovedOnSchema>;

export const liveRoomMovedOnSnapshotSchema = liveRoomMovedOnSchema.nullable().default(null);

export const liveRoomMovedOnChangedSchema = z
  .object({ type: z.literal("room.moved.changed"), movedOn: liveRoomMovedOnSchema.nullable() })
  .strict();
