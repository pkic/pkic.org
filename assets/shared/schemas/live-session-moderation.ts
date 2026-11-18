import { z } from "zod";
import {
  LIVE_MODERATION_REASON_IDS,
  LIVE_PARTICIPATION_BLOCKS,
  type LiveParticipationBlock,
} from "../live-moderation-policy";
import { utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { livePersonNameSchema } from "./live-session-change";

/**
 * Moderation that is the same for chat messages, questions and answers:
 * removal with a reason, the studio's Done flag, and blocking a person from
 * posting. Who may do what is the shared moderation policy's.
 */

export const liveModerationReasonSchema = z.enum(LIVE_MODERATION_REASON_IDS);
export const liveParticipationBlockSchema = z.enum(LIVE_PARTICIPATION_BLOCKS);

/**
 * A removed item, as its author and moderators see it. Everyone else no
 * longer receives the item. `byName` is null for the author.
 */
export const liveRemovalSchema = z
  .object({ reason: liveModerationReasonSchema, at: utcInstantSchema, byName: livePersonNameSchema.nullable() })
  .strict();
export type LiveRemoval = z.infer<typeof liveRemovalSchema>;

/** A block in force: the restricted person sees their own, moderators see an author's. */
export const liveParticipationRestrictionSchema = z
  .object({ block: liveParticipationBlockSchema, until: utcInstantSchema.nullable() })
  .strict();
export type LiveParticipationRestrictionView = z.infer<typeof liveParticipationRestrictionSchema>;

/** The item a moderation command acts on; its author is the person a block reaches. */
export const liveModerationItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat"), messageId: databaseIdSchema }).strict(),
  z.object({ kind: z.literal("question"), questionId: databaseIdSchema }).strict(),
  z.object({ kind: z.literal("answer"), questionId: databaseIdSchema, answerId: databaseIdSchema }).strict(),
]);
export type LiveModerationItem = z.infer<typeof liveModerationItemSchema>;

/** The Remove and Block dialogs' contract: a reason is always required. */
export const liveModerationReasonFormSchema = z
  .object({ reason: liveModerationReasonSchema, removePosts: z.boolean() })
  .strict();

export const liveModerationClientMessageSchemas = [
  /** Clears a question or chat message from the studio queue; attendees still see it. */
  z
    .object({
      type: z.literal("moderation.done"),
      item: liveModerationItemSchema,
      done: z.boolean(),
    })
    .strict(),
  /**
   * Keeps the item's author from posting. `removePosts` also removes their
   * posts in this session with the same reason.
   */
  z
    .object({
      type: z.literal("participation.block"),
      item: liveModerationItemSchema,
      block: liveParticipationBlockSchema,
      reason: liveModerationReasonSchema,
      removePosts: z.boolean(),
    })
    .strict(),
  /** Lets the item's author post again. Removed posts stay removed. */
  z.object({ type: z.literal("participation.lift"), item: liveModerationItemSchema }).strict(),
] as const;

export const liveModerationServerMessageSchemas = [
  /** This viewer's own restriction changed; null when they may post again. */
  z
    .object({ type: z.literal("participation.access"), restriction: liveParticipationRestrictionSchema.nullable() })
    .strict(),
] as const;

export function liveParticipationBlockLabel(block: LiveParticipationBlock): string {
  return block === "paused" ? "Paused" : block === "session" ? "Blocked for this session" : "Blocked for this event";
}
