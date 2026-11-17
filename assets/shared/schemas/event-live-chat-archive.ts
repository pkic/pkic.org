import { z } from "zod";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { authErrors, ok, requiresPermissions } from "./route-contract";

/** The most sessions one chat download or erasure reaches; an event's agenda stays well below it. */
export const LIVE_CHAT_ARCHIVE_MAX_SESSIONS = 500;
/** The largest chat download, in bytes. */
export const LIVE_CHAT_ARCHIVE_MAX_BYTES = 20 * 1024 * 1024;

/** How many sessions' chat an erasure removed, and how many it left because their room is still open. */
export const liveChatEraseResponseSchema = z
  .object({ erasedSessions: z.number().int().nonnegative(), openSessions: z.number().int().nonnegative() })
  .strict();
export type LiveChatEraseResponse = z.infer<typeof liveChatEraseResponseSchema>;

const common = { ...requiresPermissions("agenda:live_moderate"), tags: ["Events"] };

export const liveChatArchiveExportRouteSchema = {
  ...common,
  summary: "Download the attendee chat every session's live room still holds",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": {
      description: "Every kept attendee message, by session and time, in UTC",
      content: { "text/csv": { schema: z.string() } },
    },
    ...authErrors({ notFound: "Event unavailable" }),
    "413": jsonErrorResponse("The chat is larger than one download allows"),
  },
};

export const liveChatEraseRouteSchema = {
  ...common,
  summary: "Erase the chat of every session whose live room has closed",
  request: { params: eventSlugParamsSchema },
  responses: {
    ...ok("How many sessions' chat was erased", liveChatEraseResponseSchema),
    ...authErrors({ notFound: "Event unavailable" }),
  },
};
