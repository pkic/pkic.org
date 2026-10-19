import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
import { liveChangeSchema, livePersonNameSchema } from "./live-session-change";
import { publicSessionPortraitUrlSchema } from "./event-session-history";
import { liveAuthorFields } from "./live-session-author";
import { LIVE_ROOM_POLICY } from "../live-session-policy";
import {
  LIVE_CHAT_POLICY,
  LIVE_CHAT_REACTION_IDS,
  LIVE_CHAT_REPORT_REASON_IDS,
  LIVE_CHAT_RESTRICTIONS,
} from "../live-chat-policy";

/**
 * The chat part of the live room protocol: messages with their reactions,
 * reports and moderation, and the commands that act on them. Who may send
 * which command is the shared chat policy's; the room enforces it.
 */

export const liveChatChannelSchema = z.enum(["attendee", "operator"]);
export type LiveChatChannel = z.infer<typeof liveChatChannelSchema>;
export const liveChatReactionSchema = z.enum(LIVE_CHAT_REACTION_IDS);
export const liveChatReportReasonSchema = z.enum(LIVE_CHAT_REPORT_REASON_IDS);
export const liveChatRestrictionSchema = z.enum(LIVE_CHAT_RESTRICTIONS);
/** Reactions per emoji; an emoji nobody chose is absent. */
export const liveChatReactionCountsSchema = z.partialRecord(liveChatReactionSchema, z.number().int().positive());
const myReactionsSchema = z.array(liveChatReactionSchema).max(LIVE_CHAT_REACTION_IDS.length);

/** Moderators only: what the room knows about a message beyond its words. */
export const liveChatModerationSchema = z
  .object({
    /** Who hid it and when; null while it is shown. */
    hidden: liveChangeSchema.nullable(),
    /** Hidden because enough people reported it, until a moderator reviews it. */
    held: z.boolean(),
    reports: z.number().int().nonnegative(),
    reportReasons: z.partialRecord(liveChatReportReasonSchema, z.number().int().positive()),
    /** The live question this message became. */
    questionId: databaseIdSchema.nullable(),
    /** The author operates this room. */
    authorStaff: z.boolean(),
    authorRestriction: liveChatRestrictionSchema.nullable(),
  })
  .strict();
export type LiveChatModeration = z.infer<typeof liveChatModerationSchema>;

export const liveChatTextSchema = z
  .string()
  .trim()
  .min(1, "Write a message.")
  .max(LIVE_ROOM_POLICY.chatMaxLength, `Keep your message under ${LIVE_ROOM_POLICY.chatMaxLength} characters.`);

export const liveChatMessageSchema = z
  .object({
    channel: liveChatChannelSchema,
    id: databaseIdSchema,
    /** The author's words as Markdown source; browsers render the chat subset of it. */
    text: liveChatTextSchema,
    authorName: livePersonNameSchema,
    /** The author's public profile photo, when they have one. */
    authorPhotoUrl: publicSessionPortraitUrlSchema.nullable().optional(),
    ...liveAuthorFields,
    mine: z.boolean(),
    sentAt: utcInstantSchema,
    reactions: liveChatReactionCountsSchema.optional(),
    myReactions: myReactionsSchema.optional(),
    reportedByMe: z.boolean().optional(),
    /** Absent or null for everyone but moderators. */
    moderation: liveChatModerationSchema.nullable().optional(),
  })
  .strict();
export type LiveChatMessage = z.infer<typeof liveChatMessageSchema>;

const messageRefSchema = { messageId: databaseIdSchema };

// ── Client → room ───────────────────────────────────────────────────────────

/** The composer's contract: the socket message carries exactly these fields. */
export const liveChatSendSchema = z
  .object({ type: z.literal("chat.send"), text: liveChatTextSchema, channel: liveChatChannelSchema.optional() })
  .strict();

export const liveChatReportSchema = z
  .object({ type: z.literal("chat.report"), ...messageRefSchema, reason: liveChatReportReasonSchema })
  .strict();

export const liveChatClientMessageSchemas = [
  liveChatSendSchema,
  /** Adds or withdraws this person's one reaction of a kind. */
  z
    .object({ type: z.literal("chat.react"), ...messageRefSchema, reaction: liveChatReactionSchema, on: z.boolean() })
    .strict(),
  liveChatReportSchema,
  /** The author removes their own message for everyone. */
  z.object({ type: z.literal("chat.delete"), ...messageRefSchema }).strict(),
  /** A moderator hides a message from attendees, or keeps it: shown again and its reports cleared. */
  z.object({ type: z.literal("chat.moderate"), ...messageRefSchema, decision: z.enum(["hide", "keep"]) }).strict(),
  /** An organizer mutes or bans a message's author for the session, or lifts it (null). */
  z
    .object({
      type: z.literal("chat.restrict"),
      ...messageRefSchema,
      restriction: liveChatRestrictionSchema.nullable(),
    })
    .strict(),
  /** A moderator turns an attendee message into an approved live question by the same author. */
  z.object({ type: z.literal("chat.convert"), ...messageRefSchema }).strict(),
  /** Asks for the page of messages before one; null asks for the latest page. */
  z
    .object({ type: z.literal("chat.history"), channel: liveChatChannelSchema, before: databaseIdSchema.nullable() })
    .strict(),
] as const;

// ── Room → client ───────────────────────────────────────────────────────────

const chatMessagesSchema = z.array(liveChatMessageSchema).max(LIVE_CHAT_POLICY.historyPage);

export const liveChatServerMessageSchemas = [
  /** A new message, or a change to one this viewer already holds. */
  z.object({ type: z.literal("chat.message"), message: liveChatMessageSchema }).strict(),
  z.object({ type: z.literal("chat.removed"), messageId: databaseIdSchema, channel: liveChatChannelSchema }).strict(),
  /** New reaction counts; `myReactions` is null when this viewer's own reactions did not change. */
  z
    .object({
      type: z.literal("chat.reactions"),
      channel: liveChatChannelSchema,
      messageId: databaseIdSchema,
      reactions: liveChatReactionCountsSchema,
      myReactions: myReactionsSchema.nullable(),
    })
    .strict(),
  /** One earlier page for this viewer, oldest first. */
  z
    .object({
      type: z.literal("chat.history"),
      channel: liveChatChannelSchema,
      messages: chatMessagesSchema,
      hasEarlier: z.boolean(),
    })
    .strict(),
  /** This viewer's own chat restriction changed. */
  z.object({ type: z.literal("chat.access"), restriction: liveChatRestrictionSchema.nullable() }).strict(),
] as const;

/** The chat a viewer receives on joining. */
export const liveChatSnapshotFields = {
  chat: z
    .array(liveChatMessageSchema)
    .max(LIVE_CHAT_POLICY.snapshotMessages * 2)
    .default([]),
  /** Channels with messages before the ones sent. */
  chatEarlier: z.partialRecord(liveChatChannelSchema, z.boolean()).optional(),
  /** Moderators only: reported messages awaiting review, newest first. */
  chatReports: z.array(liveChatMessageSchema).max(LIVE_CHAT_POLICY.reportQueueLimit).optional(),
};
