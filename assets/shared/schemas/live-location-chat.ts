import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { eventDayDateSchema } from "./event-read-models";
import { databaseIdSchema } from "./identifiers";
import { liveRoomOpeningSnapshotSchema } from "./live-room-opening";
import { liveChatSnapshotFields } from "./live-session-chat";

/** A session the location holds that day, as the chat names it where its messages begin. */
export const liveLocationChatSessionSchema = z
  .object({
    occurrenceId: databaseIdSchema,
    title: z.string().min(1).max(300),
    startAt: utcInstantSchema,
    endAt: utcInstantSchema,
  })
  .strict();
export type LiveLocationChatSession = z.infer<typeof liveLocationChatSessionSchema>;

/** The location and event day a chat belongs to, and the sessions it dates messages by. */
export const liveLocationChatScopeSchema = z
  .object({
    eventName: z.string().min(1).max(300),
    roomId: databaseIdSchema,
    day: eventDayDateSchema,
    timeZone: z.string().min(1).max(100),
    sessions: z.array(liveLocationChatSessionSchema).max(100),
  })
  .strict();
export type LiveLocationChatScope = z.infer<typeof liveLocationChatScopeSchema>;

/**
 * What a viewer receives on joining a location's chat: the day it covers, whether attendees may write (on
 * schedule, or because an operator opened or ended it), and its latest messages in both channels as the
 * viewer may see them. Each message names the session it was sent during.
 */
export const liveLocationChatSnapshotFields = {
  scope: liveLocationChatScopeSchema,
  opening: liveRoomOpeningSnapshotSchema,
  ...liveChatSnapshotFields,
};
