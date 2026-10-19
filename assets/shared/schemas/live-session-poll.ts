import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
import { liveChangeSchema } from "./live-session-change";
import { formFieldInputSchema } from "./forms";
import { formAnswerValueSchema } from "./form-answers";
import { formSubmissionStatSchema } from "./form-management";
import { formFieldAnswerChoices } from "../form-field-statistics";
import type { CustomAnswerValue } from "../form-answer-rules";
import { formAnswersContract } from "./form-answer-contract";
import { LIVE_POLL_POLICY, LIVE_POLL_STATUSES } from "../live-session-policy";

/**
 * A session poll in the live room protocol. Its question is a form field —
 * authored with the forms editor, answered with the forms respondent
 * controls, judged by the forms answer rules and charted by the forms results
 * views — that the room asks one audience at a time and counts live.
 */

export const livePollStatusSchema = z.enum(LIVE_POLL_STATUSES);

const POLL_FIELD_TYPES: readonly string[] = LIVE_POLL_POLICY.fieldTypes;
const RATING_WIDGETS: readonly string[] = LIVE_POLL_POLICY.ratingWidgets;

/**
 * A poll's question: the form-field authoring contract, narrowed to answers
 * that can be counted live. A poll always wants an answer, so it is required.
 */
export const livePollFieldSchema = formFieldInputSchema
  .superRefine((field, context) => {
    if (!POLL_FIELD_TYPES.includes(field.fieldType)) {
      context.addIssue({
        code: "custom",
        path: ["fieldType"],
        message: "A poll asks a choice, a rating or a short written answer.",
      });
      return;
    }
    if (field.optionSource)
      context.addIssue({ code: "custom", path: ["optionSource"], message: "Write the poll's choices yourself." });
    if (field.fieldType === "text" || field.fieldType === "textarea") return;
    const offered = formFieldAnswerChoices(field).length;
    if (field.fieldType === "number") {
      if (!RATING_WIDGETS.includes(field.validation?.uiWidget ?? ""))
        context.addIssue({
          code: "custom",
          path: ["validation", "uiWidget"],
          message: "A number in a poll is a rating: choose the rating stars or NPS widget.",
        });
      else if (offered < 2 || offered > LIVE_POLL_POLICY.maxRatingScores)
        context.addIssue({
          code: "custom",
          path: ["validation", "max"],
          message: `A rating offers between 2 and ${LIVE_POLL_POLICY.maxRatingScores} scores.`,
        });
      return;
    }
    if (offered < LIVE_POLL_POLICY.minChoices || offered > LIVE_POLL_POLICY.maxChoices)
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: `Offer between ${LIVE_POLL_POLICY.minChoices} and ${LIVE_POLL_POLICY.maxChoices} choices.`,
      });
  })
  .transform((field) => ({
    ...field,
    required: true,
    ...(field.fieldType === "text" || field.fieldType === "textarea"
      ? { validation: { ...field.validation, maxLength: Math.min(field.validation?.maxLength ?? 200, 200) } }
      : {}),
  }));
export type LivePollField = z.output<typeof livePollFieldSchema>;

export const livePollSchema = z
  .object({
    id: databaseIdSchema,
    field: livePollFieldSchema,
    status: livePollStatusSchema,
    /** The operator's choice to show results to attendees. */
    showResults: z.boolean(),
    /** The running tallies as the forms results views read them; null while this viewer may not see them. */
    results: formSubmissionStatSchema.nullable(),
    /** This viewer's answer while the poll is open; null when they have not answered (or the poll closed). */
    myAnswer: formAnswerValueSchema.nullable(),
    createdAt: utcInstantSchema,
    /** Shown to operators only. */
    change: liveChangeSchema.nullable(),
  })
  .strict();
export type LivePoll = z.infer<typeof livePollSchema>;

/** The poll editor's contract: the socket message carries exactly these fields. */
export const livePollDraftSchema = z.object({ field: livePollFieldSchema, showResults: z.boolean() }).strict();
export type LivePollDraft = z.output<typeof livePollDraftSchema>;

/**
 * An answer as the poll's field accepts it, through the generated forms answer
 * contract: the normalized answer, or why it is refused. The room judges a
 * vote here; the attendee's form validates through the same contract.
 */
export function readLivePollAnswer(
  field: LivePollField,
  answer: unknown,
): { answer: CustomAnswerValue; problem: null } | { answer: null; problem: string } {
  const checked = formAnswersContract([field]).safeParse({ [field.key]: answer });
  if (!checked.success) return { answer: null, problem: checked.error.issues[0]?.message ?? "Choose an answer." };
  return { answer: checked.data[field.key], problem: null };
}

/**
 * What changing a poll that people may already have answered does. Wording
 * can always change — the question, its description and each choice's text —
 * and a choice keeps its answers through a new wording because it keeps its
 * value. Choices may be added or removed; a removed choice takes its answers
 * with it. What an answer means cannot change: the answer type, the rating
 * scale and the selection limits stay as they were opened.
 */
export function livePollLiveEdit(
  before: LivePollField,
  after: LivePollField,
): { problem: string | null; removedValues: string[] } {
  const rules = (field: LivePollField) => {
    const validation = (field.validation ?? {}) as Record<string, unknown>;
    return JSON.stringify(["uiWidget", "min", "max", "step", "minItems", "maxItems"].map((key) => validation[key]));
  };
  if (before.fieldType !== after.fieldType || before.key !== after.key)
    return { problem: "Keep the answer type: people have already answered this poll.", removedValues: [] };
  if (rules(before) !== rules(after))
    return {
      problem: "Keep the scale and selection limits: people have already answered this poll.",
      removedValues: [],
    };
  const kept = new Set(formFieldAnswerChoices(after).map((choice) => choice.value));
  return {
    problem: null,
    removedValues: formFieldAnswerChoices(before)
      .map((choice) => choice.value)
      .filter((value) => !kept.has(value)),
  };
}

/** The refusal code for an answer the poll's question does not accept; it belongs on the question. */
export const LIVE_POLL_ANSWER_REFUSAL = "LIVE_POLL_ANSWER";

export const livePollClientMessageSchemas = [
  z
    .object({
      type: z.literal("poll.save"),
      /** Null creates a poll; an id edits it, live while it is open or closed. */
      pollId: databaseIdSchema.nullable(),
      draft: livePollDraftSchema,
      /**
       * The operator confirmed that choices this edit removes take their
       * answers with them. Without it the room refuses an edit that would
       * drop answers.
       */
      discardRemovedAnswers: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal("poll.delete"), pollId: databaseIdSchema }).strict(),
  z.object({ type: z.literal("poll.status"), pollId: databaseIdSchema, status: z.enum(["open", "closed"]) }).strict(),
  z.object({ type: z.literal("poll.vote"), pollId: databaseIdSchema, answer: formAnswerValueSchema }).strict(),
] as const;

export const livePollServerMessageSchemas = [
  z.object({ type: z.literal("poll.changed"), poll: livePollSchema }).strict(),
  z.object({ type: z.literal("poll.removed"), pollId: databaseIdSchema }).strict(),
] as const;

/** The one ordering of a room's polls: the order they were prepared in. */
export function compareLivePolls(left: { createdAt: string; id: string }, right: { createdAt: string; id: string }) {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export const livePollPresentationSchema = z
  .object({
    chart: z.enum(["bar", "donut", "pie", "wordcloud"]).default("bar"),
  })
  .strict();
export type LivePollPresentation = z.infer<typeof livePollPresentationSchema>;
export const DEFAULT_LIVE_POLL_PRESENTATION: LivePollPresentation = livePollPresentationSchema.parse({});
