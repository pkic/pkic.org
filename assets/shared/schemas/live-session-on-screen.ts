import { z } from "zod";
import { LIVE_CHAT_POLICY } from "../live-chat-policy";
import { LIVE_ON_SCREEN_LIST_POLICY } from "../live-on-screen-lists";
import { LIVE_ROOM_POLICY } from "../live-session-policy";
import { databaseIdSchema } from "./identifiers";
import { livePersonNameSchema } from "./live-session-change";

/**
 * The audience lists an output shows. An operator names how many lines; the
 * room fills them from what its moderation lets the audience see, and fills
 * them again as votes, moderation and chat change.
 */

const count = (policy: { min: number; max: number }) => z.number().int().min(policy.min).max(policy.max);

export const liveTopQuestionsConfigSchema = z.object({ count: count(LIVE_ON_SCREEN_LIST_POLICY.questions) }).strict();
export type LiveTopQuestionsConfig = z.infer<typeof liveTopQuestionsConfigSchema>;
export const DEFAULT_LIVE_TOP_QUESTIONS_CONFIG: LiveTopQuestionsConfig = {
  count: LIVE_ON_SCREEN_LIST_POLICY.questions.default,
};

export const liveChatFeedConfigSchema = z.object({ count: count(LIVE_ON_SCREEN_LIST_POLICY.chat) }).strict();
export type LiveChatFeedConfig = z.infer<typeof liveChatFeedConfigSchema>;
export const DEFAULT_LIVE_CHAT_FEED_CONFIG: LiveChatFeedConfig = { count: LIVE_ON_SCREEN_LIST_POLICY.chat.default };

/** One open question as an output lists it; an anonymous author stays anonymous. */
export const liveTopQuestionSchema = z
  .object({
    id: databaseIdSchema,
    text: z.string().min(1).max(LIVE_ROOM_POLICY.questionMaxLength),
    authorName: livePersonNameSchema.nullable(),
    votes: z.number().int().nonnegative(),
  })
  .strict();
export type LiveTopQuestion = z.infer<typeof liveTopQuestionSchema>;

export const liveTopQuestionsOnAirSchema = z
  .object({
    config: liveTopQuestionsConfigSchema,
    questions: z.array(liveTopQuestionSchema).max(LIVE_ON_SCREEN_LIST_POLICY.questions.max),
  })
  .strict();
export type LiveTopQuestionsOnAir = z.infer<typeof liveTopQuestionsOnAirSchema>;

/** One attendee message as an output shows it: plain words, cut to the broadcast's length. */
export const liveChatFeedMessageSchema = z
  .object({
    id: databaseIdSchema,
    authorName: livePersonNameSchema,
    text: z.string().min(1).max(LIVE_CHAT_POLICY.tickerMessageLength),
  })
  .strict();
export type LiveChatFeedMessage = z.infer<typeof liveChatFeedMessageSchema>;

export const liveChatFeedOnAirSchema = z
  .object({
    config: liveChatFeedConfigSchema,
    /** Oldest first, so the newest message sits at the bottom, as in the chat itself. */
    messages: z.array(liveChatFeedMessageSchema).max(LIVE_ON_SCREEN_LIST_POLICY.chat.max),
  })
  .strict();
export type LiveChatFeedOnAir = z.infer<typeof liveChatFeedOnAirSchema>;
