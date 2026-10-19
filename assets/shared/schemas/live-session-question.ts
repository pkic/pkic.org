import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
import { LIVE_QUESTION_STATUSES, LIVE_ROOM_POLICY } from "../live-session-policy";
import { liveAuthorFields } from "./live-session-author";
import { liveChangeSchema, livePersonNameSchema } from "./live-session-change";
import { publicSessionPortraitUrlSchema } from "./event-session-history";

export const liveQuestionStatusSchema = z.enum(LIVE_QUESTION_STATUSES);

const questionTextSchema = z.string().min(1).max(LIVE_ROOM_POLICY.questionMaxLength);

export const liveQuestionSchema = z
  .object({
    id: databaseIdSchema,
    /** The text the room shows: an operator's rewrite when there is one, else the author's own words. */
    text: questionTextSchema,
    status: liveQuestionStatusSchema,
    votes: z.number().int().nonnegative(),
    /** The author chose to stay anonymous to other attendees; moderators always see the name. */
    anonymous: z.boolean(),
    /** Null when the question is anonymous to this viewer. */
    authorName: livePersonNameSchema.nullable(),
    /** The author's profile photo; null when they asked anonymously or have none. */
    authorPhotoUrl: publicSessionPortraitUrlSchema.nullable().default(null),
    /** The author's room handle, capacity and roles, under the same anonymity as the name. */
    ...liveAuthorFields,
    mine: z.boolean(),
    revision: z.number().int().nonnegative().default(0),
    withdrawn: z.boolean().default(false),
    canEdit: z.boolean().default(false),
    votedByMe: z.boolean(),
    askedAt: utcInstantSchema,
    answeredAt: utcInstantSchema.nullable(),
    moderated: liveChangeSchema.nullable(),
    /** Moderators only: the author's own words once an operator rewrote the question. */
    originalText: questionTextSchema.nullable(),
    /** Moderators only: who last rewrote the question. */
    rewritten: liveChangeSchema.nullable(),
  })
  .strict();
export type LiveQuestion = z.infer<typeof liveQuestionSchema>;

const questionBodySchema = z
  .string()
  .trim()
  .min(LIVE_ROOM_POLICY.questionMinLength, "Write a question of at least a few characters.")
  .max(
    LIVE_ROOM_POLICY.questionMaxLength,
    `Keep your question under ${LIVE_ROOM_POLICY.questionMaxLength} characters.`,
  );

/** The ask form's contract: the socket message carries exactly these fields. */
export const liveQuestionAskSchema = z.object({ text: questionBodySchema, anonymous: z.boolean() }).strict();

/**
 * The rewrite editor's contract. The operator submits the text the room will
 * show; the author's own words stay on the question for the record. A later
 * writing assistant only proposes this text: the operator still sends it.
 */
export const liveQuestionRewriteSchema = z.object({ text: questionBodySchema }).strict();

const questionAuthorRequestFields = {
  questionId: databaseIdSchema,
  operationId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
};
export const liveQuestionEditSchema = liveQuestionRewriteSchema.extend({
  type: z.literal("question.edit"),
  ...questionAuthorRequestFields,
});
export const liveQuestionWithdrawSchema = z
  .object({
    type: z.literal("question.withdraw"),
    ...questionAuthorRequestFields,
  })
  .strict();
