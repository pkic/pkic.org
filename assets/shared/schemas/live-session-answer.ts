import { z } from "zod";
import { LIVE_QUESTION_ANSWER_POLICY } from "../live-session-policy";
import { utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { liveAuthorFields } from "./live-session-author";
import { livePersonNameSchema } from "./live-session-change";
import {
  liveModerationReasonSchema,
  liveParticipationRestrictionSchema,
  liveRemovalSchema,
} from "./live-session-moderation";

/** The same answer text contract validates the attendee form and room command. */
export const liveQuestionAnswerCreateSchema = z
  .object({
    text: z.string().trim().min(LIVE_QUESTION_ANSWER_POLICY.minLength).max(LIVE_QUESTION_ANSWER_POLICY.maxLength),
  })
  .strict();

/** An answer carries display attribution, never another participant's contact or account identifier. */
export const liveQuestionAnswerSchema = liveQuestionAnswerCreateSchema
  .extend({
    id: databaseIdSchema,
    authorName: livePersonNameSchema,
    ...liveAuthorFields,
    mine: z.boolean(),
    createdAt: utcInstantSchema,
    revision: z.number().int().nonnegative(),
    acceptance: z.object({ byName: livePersonNameSchema.nullable(), at: utcInstantSchema }).strict().nullable(),
    votes: z.number().int().nonnegative(),
    votedByMe: z.boolean(),
    /** The author and moderators only: a moderator removed it, and why. Everyone else no longer receives it. */
    removal: liveRemovalSchema.nullable(),
    /** Moderators only: the author's block in force. */
    authorRestriction: liveParticipationRestrictionSchema.nullable(),
    /** Moderators only: the author operates this room, so no one blocks them. */
    authorStaff: z.boolean(),
  })
  .strict();
export type LiveQuestionAnswer = z.infer<typeof liveQuestionAnswerSchema>;

/** Opening one thread replaces the socket's prior thread subscription; null closes it. */
export const liveQuestionAnswersWatchSchema = z
  .object({ type: z.literal("question.answers.watch"), questionId: databaseIdSchema.nullable() })
  .strict();

export const liveQuestionAnswerSendSchema = liveQuestionAnswerCreateSchema.extend({
  type: z.literal("question.answer"),
  questionId: databaseIdSchema,
  operationId: z.uuid(),
});

/** Revision guards stop an old acceptance command from overwriting a later decision. */
export const liveQuestionAnswerAcceptSchema = z
  .object({
    type: z.literal("question.answer.accept"),
    questionId: databaseIdSchema,
    answerId: databaseIdSchema,
    operationId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    accepted: z.boolean(),
  })
  .strict();

/** One vote per person per answer; not on your own answer. */
export const liveQuestionAnswerVoteSchema = z
  .object({
    type: z.literal("question.answer.vote"),
    questionId: databaseIdSchema,
    answerId: databaseIdSchema,
    voted: z.boolean(),
  })
  .strict();

/** A moderator removes an answer from everyone with a reason the author sees, or shows it again. */
export const liveQuestionAnswerHideSchema = z
  .object({
    type: z.literal("question.answer.hide"),
    questionId: databaseIdSchema,
    answerId: databaseIdSchema,
    hidden: z.boolean(),
    reason: liveModerationReasonSchema.optional(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.hidden && !value.reason)
      context.addIssue({ code: "custom", path: ["reason"], message: "Choose why you remove this answer." });
  });

/** The answer commands in the room's client message union. */
export const liveQuestionAnswerClientMessageSchemas = [
  liveQuestionAnswersWatchSchema,
  liveQuestionAnswerSendSchema,
  liveQuestionAnswerAcceptSchema,
  liveQuestionAnswerVoteSchema,
  liveQuestionAnswerHideSchema,
] as const;

/** A sender-only receipt for either a reply or an acceptance decision. */
export const liveQuestionAnswerResultSchema = z
  .object({
    type: z.literal("question.answer.result"),
    operationId: z.uuid(),
    questionId: databaseIdSchema,
    answerId: databaseIdSchema,
  })
  .strict();

/** Only the currently expanded thread is delivered, with permissions derived by the room. */
export const liveQuestionAnswersSchema = z
  .object({
    type: z.literal("question.answers"),
    questionId: databaseIdSchema,
    answers: z.array(liveQuestionAnswerSchema).max(LIVE_QUESTION_ANSWER_POLICY.maxAnswersPerQuestion),
    canAnswer: z.boolean(),
    canAccept: z.boolean(),
    /** Whether this viewer may vote on others' answers; a block the viewer holds is applied by the client and the room. */
    canVote: z.boolean(),
    /** Moderators: may remove answers and show them again. */
    canModerate: z.boolean(),
  })
  .strict();
