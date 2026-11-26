import { z } from "zod";

/**
 * How many distinct people have a room's attendee page open now: attendees
 * and the session's speakers, several tabs of one person counted once.
 * Operators and the room's screens are not counted, nor livestream viewers.
 * Operators only, never stored; the room sends it when the number changes.
 */
export const liveRoomAudienceChangedSchema = z
  .object({ type: z.literal("audience.changed"), people: z.number().int().nonnegative().max(1_000_000) })
  .strict();
export type LiveRoomAudienceChanged = z.infer<typeof liveRoomAudienceChangedSchema>;
