/**
 * Transport contracts for classifiers: the PKIC-wide settings for all content
 * and for each kind, what an event adds to them, a trial run on sample text, and a stored verdict.
 */
import { z } from "zod";
import { eventSlugParamsSchema, jsonErrorResponse, trimmedString, utcInstantSchema } from "./api-common.ts";
import {
  CLASSIFIER_KINDS,
  CLASSIFIER_MAX_EVENT_QUESTIONS,
  CLASSIFIER_MAX_KIND_QUESTIONS,
  CLASSIFIER_MAX_QUESTIONS,
  CLASSIFIER_MAX_SHARED_QUESTIONS,
  CLASSIFIER_MAX_WIDE_QUESTIONS,
  CLASSIFIER_MODELS,
  CLASSIFIER_OUTCOMES,
  CLASSIFIER_QUESTION_ID_PATTERN,
  EVENT_CLASSIFIER_KINDS,
} from "../classifiers.ts";

export const classifierKindSchema = z.enum(CLASSIFIER_KINDS);
/** The kinds an event may add to; a member page or bio check is PKIC-wide only. */
export const eventClassifierKindSchema = z.enum(EVENT_CLASSIFIER_KINDS);
export const classifierModelSchema = z.enum(CLASSIFIER_MODELS);
export const classifierOutcomeSchema = z.enum(CLASSIFIER_OUTCOMES);

export const classifierKindParamsSchema = z.object({ kind: classifierKindSchema });
export const eventClassifierKindParamsSchema = eventSlugParamsSchema.extend({ kind: eventClassifierKindSchema });

const questionIdSchema = z
  .string()
  .trim()
  .regex(
    CLASSIFIER_QUESTION_ID_PATTERN,
    "Use 2 to 40 lowercase letters, digits and underscores, starting with a letter.",
  );
const percentSchema = z.number().int().min(1, "Enter 1 or more.").max(100, "Enter 100 or less.");
const questionTextSchema = trimmedString(1, 2000, "Enter the question.");

export const classifierFlagSchema = z
  .object({
    id: questionIdSchema,
    kind: z.literal("flag"),
    question: questionTextSchema,
    adviseAtPercent: percentSchema,
    blockAtPercent: percentSchema.nullable(),
    message: trimmedString(1, 400, "Enter what the author is told."),
  })
  .refine((flag) => flag.blockAtPercent === null || flag.blockAtPercent >= flag.adviseAtPercent, {
    path: ["blockAtPercent"],
    message: "Block at the advise level or above.",
  });

export const classifierScoreSchema = z.object({
  id: questionIdSchema,
  kind: z.literal("score"),
  label: trimmedString(1, 60, "Enter a name."),
  question: questionTextSchema,
  levels: z
    .array(trimmedString(1, 300, "Describe the level."))
    .min(2, "Add at least 2 levels.")
    .max(10, "Use at most 10 levels."),
  weight: z.number().min(0.1, "Enter 0.1 or more.").max(10, "Enter 10 or less."),
});

export const classifierQuestionSchema = z.discriminatedUnion("kind", [classifierFlagSchema, classifierScoreSchema]);

const questionsSchema = (max: number) =>
  z
    .array(classifierQuestionSchema)
    .max(max, `Ask at most ${max} questions.`)
    .refine((questions) => new Set(questions.map((question) => question.id)).size === questions.length, {
      message: "Give each question its own id.",
    });

const contextSchema = z.string().trim().max(8000).default("");

/** What all content asks: the context and flags every kind reads before its own. */
export const classifierSharedSettingsInputSchema = z.object({
  expectedRevision: z.number().int().min(0),
  context: contextSchema,
  questions: questionsSchema(CLASSIFIER_MAX_SHARED_QUESTIONS),
});
export type ClassifierSharedSettingsInput = z.infer<typeof classifierSharedSettingsInputSchema>;

/** One kind's own settings; a question with an all-content id replaces it for this kind. */
export const classifierSettingsInputSchema = z.object({
  expectedRevision: z.number().int().min(0),
  enabled: z.boolean(),
  model: classifierModelSchema,
  context: contextSchema,
  questions: questionsSchema(CLASSIFIER_MAX_KIND_QUESTIONS),
  /** The all-content questions this kind does not ask. */
  disabledQuestionIds: z.array(questionIdSchema).max(CLASSIFIER_MAX_SHARED_QUESTIONS).default([]),
});
export type ClassifierSettingsInput = z.infer<typeof classifierSettingsInputSchema>;

export const classifierEventAdditionsInputSchema = z.object({
  expectedRevision: z.number().int().min(0),
  context: contextSchema,
  questions: questionsSchema(CLASSIFIER_MAX_EVENT_QUESTIONS),
  disabledQuestionIds: z.array(questionIdSchema).max(CLASSIFIER_MAX_WIDE_QUESTIONS).default([]),
});
export type ClassifierEventAdditionsInput = z.infer<typeof classifierEventAdditionsInputSchema>;

const settingsShape = {
  enabled: z.boolean(),
  model: classifierModelSchema,
  context: z.string(),
  questions: z.array(classifierQuestionSchema),
};

/** The settings a check runs with, PKIC-wide or as one event's effective check. */
export const classifierSettingsSchema = z.object(settingsShape);

const savedShape = {
  revision: z.number().int(),
  /** False until staff save these settings. */
  saved: z.boolean(),
  updatedAt: utcInstantSchema.nullable(),
};

export const classifierSharedSettingsResponseSchema = z.object({
  ...savedShape,
  context: z.string(),
  questions: z.array(classifierQuestionSchema),
});
export type ClassifierSharedSettingsResponse = z.infer<typeof classifierSharedSettingsResponseSchema>;

/** One kind's own settings, without the all-content layer; an unsaved kind is off and asks nothing of its own. */
export const classifierSettingsResponseSchema = z.object({
  kind: classifierKindSchema,
  ...savedShape,
  ...settingsShape,
  disabledQuestionIds: z.array(z.string()),
});
export type ClassifierSettingsResponse = z.infer<typeof classifierSettingsResponseSchema>;

export const classifierSettingsListResponseSchema = z.object({
  shared: classifierSharedSettingsResponseSchema,
  classifiers: z.array(classifierSettingsResponseSchema),
});
export type ClassifierSettingsListResponse = z.infer<typeof classifierSettingsListResponseSchema>;

export const eventClassifierResponseSchema = z.object({
  kind: eventClassifierKindSchema,
  /** The PKIC-wide check the event starts from: all content with the kind's own. */
  settings: classifierSettingsSchema,
  additions: z.object({
    revision: z.number().int(),
    context: z.string(),
    questions: z.array(classifierQuestionSchema),
    disabledQuestionIds: z.array(z.string()),
    updatedAt: utcInstantSchema.nullable(),
  }),
  /** The check as it runs for this event. */
  effective: classifierSettingsSchema,
});
export type EventClassifierResponse = z.infer<typeof eventClassifierResponseSchema>;

export const classifierVerdictSchema = z.object({
  outcome: classifierOutcomeSchema,
  flags: z.array(
    z.object({ id: z.string(), probabilityPercent: z.number(), blocking: z.boolean(), message: z.string() }),
  ),
  scores: z.array(z.object({ id: z.string(), label: z.string(), percent: z.number(), level: z.string() })),
  scorePercent: z.number().nullable(),
});
export type ClassifierVerdictPayload = z.infer<typeof classifierVerdictSchema>;

/** A trial: the check run on sample text with settings that need not be saved. */
export const classifierTrialInputSchema = z.object({
  text: trimmedString(1, 20000, "Enter a sample."),
  title: z.string().trim().max(300).default(""),
  model: classifierModelSchema,
  context: contextSchema,
  questions: questionsSchema(CLASSIFIER_MAX_QUESTIONS).refine((questions) => questions.length > 0, {
    message: "Add a question.",
  }),
});
export type ClassifierTrialInput = z.infer<typeof classifierTrialInputSchema>;

export const classifierTrialResponseSchema = z.object({
  verdict: classifierVerdictSchema,
  model: classifierModelSchema.nullable(),
  latencyMs: z.number().int(),
  /** The answer to every question, raised or not, for tuning. */
  answers: z.array(z.object({ id: z.string(), percent: z.number() })),
});
export type ClassifierTrialResponse = z.infer<typeof classifierTrialResponseSchema>;

/** A stored check of one piece of content, as reviewers and moderators see it. */
export const classifierResultSchema = classifierVerdictSchema.extend({
  model: classifierModelSchema.nullable(),
  latencyMs: z.number().int(),
  checkedAt: utcInstantSchema,
});
export type ClassifierResult = z.infer<typeof classifierResultSchema>;

const routeJson = <Schema extends z.ZodType>(schema: Schema) => ({ "application/json": { schema } });
const staffAuth = { "x-pkic-auth": { required: true, scopes: ["events:manage"] } } as const;
const eventReaderAuth = { "x-pkic-auth": { required: true, scopes: ["events:read"] } } as const;
const eventOrganizerAuth = { "x-pkic-auth": { required: true, scopes: ["events:write"] } } as const;
const routeRefusals = {
  "400": jsonErrorResponse("Invalid classifier settings."),
  "401": jsonErrorResponse("An authenticated user session is required."),
  "403": jsonErrorResponse("The required permission is missing."),
  "404": jsonErrorResponse("Event not found."),
  "409": jsonErrorResponse("The settings changed; reload before saving."),
};
export const classifierSavedResponseSchema = z.object({ success: z.literal(true), revision: z.number().int() });

export const classifiersListRouteSchema = {
  tags: ["Classifiers"],
  summary: "List the PKIC-wide classifiers",
  responses: {
    "200": { description: "Every classifier.", content: routeJson(classifierSettingsListResponseSchema) },
    ...routeRefusals,
  },
  ...staffAuth,
};
export const classifierSharedSettingsPutRouteSchema = {
  tags: ["Classifiers"],
  summary: "Change what every PKIC-wide classifier asks",
  request: { body: { required: true, content: routeJson(classifierSharedSettingsInputSchema) } },
  responses: {
    "200": { description: "Saved.", content: routeJson(classifierSavedResponseSchema) },
    ...routeRefusals,
  },
  ...staffAuth,
};
export const classifierSettingsPutRouteSchema = {
  tags: ["Classifiers"],
  summary: "Change a PKIC-wide classifier",
  request: {
    params: classifierKindParamsSchema,
    body: { required: true, content: routeJson(classifierSettingsInputSchema) },
  },
  responses: {
    "200": { description: "Saved.", content: routeJson(classifierSavedResponseSchema) },
    ...routeRefusals,
  },
  ...staffAuth,
};
export const classifierTrialRouteSchema = {
  tags: ["Classifiers"],
  summary: "Try a classifier on a sample",
  request: {
    params: classifierKindParamsSchema,
    body: { required: true, content: routeJson(classifierTrialInputSchema) },
  },
  responses: {
    "200": { description: "The verdict.", content: routeJson(classifierTrialResponseSchema) },
    ...routeRefusals,
  },
  ...staffAuth,
};
export const eventClassifierGetRouteSchema = {
  tags: ["Classifiers"],
  summary: "Get a classifier as it runs for an event",
  request: { params: eventClassifierKindParamsSchema },
  responses: {
    "200": { description: "The classifier.", content: routeJson(eventClassifierResponseSchema) },
    ...routeRefusals,
  },
  ...eventReaderAuth,
};
export const eventClassifierPutRouteSchema = {
  tags: ["Classifiers"],
  summary: "Change what an event adds to a classifier",
  request: {
    params: eventClassifierKindParamsSchema,
    body: { required: true, content: routeJson(classifierEventAdditionsInputSchema) },
  },
  responses: {
    "200": { description: "Saved.", content: routeJson(classifierSavedResponseSchema) },
    ...routeRefusals,
  },
  ...eventOrganizerAuth,
};
export const eventClassifierTrialRouteSchema = {
  tags: ["Classifiers"],
  summary: "Try an event's classifier on a sample",
  request: {
    params: eventClassifierKindParamsSchema,
    body: { required: true, content: routeJson(classifierTrialInputSchema) },
  },
  responses: {
    "200": { description: "The verdict.", content: routeJson(classifierTrialResponseSchema) },
    ...routeRefusals,
  },
  ...eventOrganizerAuth,
};
