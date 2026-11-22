import { z } from "zod";
import { LIVE_PREPARED_QUESTION_POLICY, LIVE_ROOM_POLICY } from "../live-session-policy";
import { utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { liveQuestionAddresseeSchema, liveQuestionAskSchema } from "./live-session-question";

/**
 * Questions operators write ahead of or during a session. Each waits here,
 * seen by operators only, until it comes into the open list at its release
 * moment or an operator releases it: approved, anonymous and without votes,
 * so nobody else can tell it was prepared.
 */
export const livePreparedQuestionSchema = z
  .object({
    id: databaseIdSchema,
    text: z.string().min(1).max(LIVE_ROOM_POLICY.questionMaxLength),
    addressedTo: liveQuestionAddresseeSchema,
    /** When the room releases it; in the past only while the room is too full to take it. */
    releaseAt: utcInstantSchema,
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type LivePreparedQuestion = z.infer<typeof livePreparedQuestionSchema>;

const windowFields = { from: utcInstantSchema, until: utcInstantSchema };
const windowOrdered = {
  check: (window: { from: string; until: string }) => Date.parse(window.from) < Date.parse(window.until),
  issue: { path: ["until"], message: "End the release window after it starts." },
};

/** The span in which prepared questions come into the list at random moments. */
export const livePreparedQuestionWindowSchema = z
  .object(windowFields)
  .strict()
  .refine(windowOrdered.check, windowOrdered.issue);

/** The prepare form's contract: the same wording rules and addressee as an attendee's question. */
export const livePreparedQuestionInputSchema = liveQuestionAskSchema.pick({ text: true, addressedTo: true });

export const livePreparedQuestionsSchema = z
  .array(livePreparedQuestionSchema)
  .max(LIVE_PREPARED_QUESTION_POLICY.maxPerRoom);

export const livePreparedQuestionClientMessageSchemas = [
  livePreparedQuestionInputSchema
    .extend({
      type: z.literal("question.prepare"),
      /** Null prepares a new question; an id edits one still waiting. */
      preparedId: databaseIdSchema.nullable(),
      /** The revision the edit is based on; a newer one is refused instead of overwritten. */
      expectedRevision: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.object({ type: z.literal("question.prepared.delete"), preparedId: databaseIdSchema }).strict(),
  /** Releases a prepared question into the open list now. */
  z.object({ type: z.literal("question.prepared.release"), preparedId: databaseIdSchema }).strict(),
  /** Moves the release window; every waiting question draws a new moment within it. */
  z
    .object({ type: z.literal("question.prepared.window"), ...windowFields })
    .strict()
    .refine(windowOrdered.check, windowOrdered.issue),
] as const;

export const livePreparedQuestionServerMessageSchemas = [
  /** Operators only: the waiting questions or their release window changed. */
  z
    .object({
      type: z.literal("question.prepared.changed"),
      preparedQuestions: livePreparedQuestionsSchema,
      window: livePreparedQuestionWindowSchema,
    })
    .strict(),
] as const;
