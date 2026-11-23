/**
 * Transport contracts for automatic checks: the PKIC-wide settings, what an
 * event adds to them, a trial run on sample text, and a stored verdict.
 */
import { z } from "zod";
import { eventSlugParamsSchema, jsonErrorResponse, trimmedString, utcInstantSchema } from "./api-common.ts";
import {
  CLASSIFIER_KINDS,
  CLASSIFIER_MAX_QUESTIONS,
  CLASSIFIER_MODELS,
  CLASSIFIER_OUTCOMES,
  CLASSIFIER_QUESTION_ID_PATTERN,
} from "../classifiers.ts";

export const classifierKindSchema = z.enum(CLASSIFIER_KINDS);
export const classifierModelSchema = z.enum(CLASSIFIER_MODELS);
export const classifierOutcomeSchema = z.enum(CLASSIFIER_OUTCOMES);

export const classifierKindParamsSchema = z.object({ kind: classifierKindSchema });
export const eventClassifierKindParamsSchema = eventSlugParamsSchema.extend({ kind: classifierKindSchema });

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

const questionsSchema = z
  .array(classifierQuestionSchema)
  .max(CLASSIFIER_MAX_QUESTIONS, `Ask at most ${CLASSIFIER_MAX_QUESTIONS} questions.`)
  .refine((questions) => new Set(questions.map((question) => question.id)).size === questions.length, {
    message: "Give each question its own id.",
  });

const contextSchema = z.string().trim().max(8000).default("");

export const classifierSettingsInputSchema = z.object({
  expectedRevision: z.number().int().min(0),
  enabled: z.boolean(),
  model: classifierModelSchema,
  context: contextSchema,
  questions: questionsSchema,
});
export type ClassifierSettingsInput = z.infer<typeof classifierSettingsInputSchema>;

export const classifierEventAdditionsInputSchema = z.object({
  expectedRevision: z.number().int().min(0),
  context: contextSchema,
  questions: questionsSchema,
  disabledQuestionIds: z.array(questionIdSchema).max(CLASSIFIER_MAX_QUESTIONS).default([]),
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

export const classifierSettingsResponseSchema = z.object({
  kind: classifierKindSchema,
  revision: z.number().int(),
  /** False until staff save settings; the kind is then off and asks nothing. */
  saved: z.boolean(),
  updatedAt: utcInstantSchema.nullable(),
  ...settingsShape,
});
export type ClassifierSettingsResponse = z.infer<typeof classifierSettingsResponseSchema>;

export const classifierSettingsListResponseSchema = z.object({
  checks: z.array(classifierSettingsResponseSchema),
});

export const eventClassifierResponseSchema = z.object({
  kind: classifierKindSchema,
  settings: classifierSettingsResponseSchema,
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
  text: trimmedString(1, 20000, "Enter text to check."),
  title: z.string().trim().max(300).default(""),
  model: classifierModelSchema,
  context: contextSchema,
  questions: questionsSchema.refine((questions) => questions.length > 0, { message: "Add a question." }),
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
  "400": jsonErrorResponse("Invalid check settings."),
  "401": jsonErrorResponse("An authenticated user session is required."),
  "403": jsonErrorResponse("The required permission is missing."),
  "404": jsonErrorResponse("Event not found."),
  "409": jsonErrorResponse("The settings changed; reload before saving."),
};
export const classifierSavedResponseSchema = z.object({ success: z.literal(true), revision: z.number().int() });

export const classifiersListRouteSchema = {
  tags: ["Classifiers"],
  summary: "List the PKIC-wide automatic checks",
  responses: {
    "200": { description: "Every check.", content: routeJson(classifierSettingsListResponseSchema) },
    ...routeRefusals,
  },
  ...staffAuth,
};
export const classifierSettingsPutRouteSchema = {
  tags: ["Classifiers"],
  summary: "Change a PKIC-wide automatic check",
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
  summary: "Try an automatic check on sample text",
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
  summary: "Get an automatic check as it runs for an event",
  request: { params: eventClassifierKindParamsSchema },
  responses: {
    "200": { description: "The check.", content: routeJson(eventClassifierResponseSchema) },
    ...routeRefusals,
  },
  ...eventReaderAuth,
};
export const eventClassifierPutRouteSchema = {
  tags: ["Classifiers"],
  summary: "Change what an event adds to an automatic check",
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
  summary: "Try an event's automatic check on sample text",
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
