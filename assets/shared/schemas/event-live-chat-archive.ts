import { z } from "zod";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { authErrors, ok, requiresPermissions } from "./route-contract";

/** The most chats, one per room and event day, one download or erasure reaches; an event stays well below it. */
export const LIVE_CHAT_ARCHIVE_MAX_CHATS = 500;
/** The largest chat download, in bytes. */
export const LIVE_CHAT_ARCHIVE_MAX_BYTES = 20 * 1024 * 1024;

/** How many chats, one per room and event day, an erasure removed, and how many it left because they are still open. */
export const liveChatEraseResponseSchema = z
  .object({ erasedChats: z.number().int().nonnegative(), openChats: z.number().int().nonnegative() })
  .strict();
export type LiveChatEraseResponse = z.infer<typeof liveChatEraseResponseSchema>;

/** The kept chat belongs to the event's records: whoever may change the event's settings downloads and erases it. */
const common = { ...requiresPermissions("events:write"), tags: ["Events"] };

export const liveChatArchiveExportRouteSchema = {
  ...common,
  summary: "Download the attendee chat every room still holds",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": {
      description: "Every kept attendee message, by room, day and time, in UTC, with the session it was sent during",
      content: { "text/csv": { schema: z.string() } },
    },
    ...authErrors({ notFound: "Event unavailable" }),
    "413": jsonErrorResponse("The chat is larger than one download allows"),
  },
};

export const liveChatEraseRouteSchema = {
  ...common,
  summary: "Erase every room's chat whose day is over",
  request: { params: eventSlugParamsSchema },
  responses: {
    ...ok("How many chats were erased", liveChatEraseResponseSchema),
    ...authErrors({ notFound: "Event unavailable" }),
  },
};
