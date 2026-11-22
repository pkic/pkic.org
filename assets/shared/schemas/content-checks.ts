/**
 * Transport contracts for automatic checks: the PKIC-wide settings, what an
 * event adds to them, a trial run on sample text, and a stored verdict.
 */
import { z } from "zod";
import { eventSlugParamsSchema, jsonErrorResponse, trimmedString, utcInstantSchema } from "./api-common";
import {
  CONTENT_CHECK_KINDS,
  CONTENT_CHECK_MAX_QUESTIONS,
  CONTENT_CHECK_MODELS,
  CONTENT_CHECK_OUTCOMES,
  CONTENT_CHECK_QUESTION_ID_PATTERN,
} from "../content-checks";

export const contentCheckKindSchema = z.enum(CONTENT_CHECK_KINDS);
export const contentCheckModelSchema = z.enum(CONTENT_CHECK_MODELS);
export const contentCheckOutcomeSchema = z.enum(CONTENT_CHECK_OUTCOMES);

export const contentCheckKindParamsSchema = z.object({ kind: contentCheckKindSchema });
export const eventContentCheckKindParamsSchema = eventSlugParamsSchema.extend({ kind: contentCheckKindSchema });

const questionIdSchema = z
  .string()
  .trim()
  .regex(
    CONTENT_CHECK_QUESTION_ID_PATTERN,
    "Use 2 to 40 lowercase letters, digits and underscores, starting with a letter.",
  );
const percentSchema = z.number().int().min(1, "Enter 1 or more.").max(100, "Enter 100 or less.");
const questionTextSchema = trimmedString(1, 2000, "Enter the question.");

export const contentCheckFlagSchema = z
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

export const contentCheckScoreSchema = z.object({
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

export const contentCheckQuestionSchema = z.discriminatedUnion("kind", [
  contentCheckFlagSchema,
  contentCheckScoreSchema,
]);

const questionsSchema = z
  .array(contentCheckQuestionSchema)
  .max(CONTENT_CHECK_MAX_QUESTIONS, `Ask at most ${CONTENT_CHECK_MAX_QUESTIONS} questions.`)
  .refine((questions) => new Set(questions.map((question) => question.id)).size === questions.length, {
    message: "Give each question its own id.",
  });

const contextSchema = z.string().trim().max(8000).default("");

export const contentCheckSettingsInputSchema = z.object({
  expectedRevision: z.number().int().min(0),
  enabled: z.boolean(),
  model: contentCheckModelSchema,
  context: contextSchema,
  questions: questionsSchema,
});
export type ContentCheckSettingsInput = z.infer<typeof contentCheckSettingsInputSchema>;

export const contentCheckEventAdditionsInputSchema = z.object({
  expectedRevision: z.number().int().min(0),
  context: contextSchema,
  questions: questionsSchema,
  disabledQuestionIds: z.array(questionIdSchema).max(CONTENT_CHECK_MAX_QUESTIONS).default([]),
});
export type ContentCheckEventAdditionsInput = z.infer<typeof contentCheckEventAdditionsInputSchema>;

const settingsShape = {
  enabled: z.boolean(),
  model: contentCheckModelSchema,
  context: z.string(),
  questions: z.array(contentCheckQuestionSchema),
};

export const contentCheckSettingsResponseSchema = z.object({
  kind: contentCheckKindSchema,
  revision: z.number().int(),
  /** False while the built-in questions apply because staff have saved none. */
  saved: z.boolean(),
  updatedAt: utcInstantSchema.nullable(),
  ...settingsShape,
});
export type ContentCheckSettingsResponse = z.infer<typeof contentCheckSettingsResponseSchema>;

export const contentCheckSettingsListResponseSchema = z.object({
  checks: z.array(contentCheckSettingsResponseSchema),
});

export const eventContentCheckResponseSchema = z.object({
  kind: contentCheckKindSchema,
  settings: contentCheckSettingsResponseSchema,
  additions: z.object({
    revision: z.number().int(),
    context: z.string(),
    questions: z.array(contentCheckQuestionSchema),
    disabledQuestionIds: z.array(z.string()),
    updatedAt: utcInstantSchema.nullable(),
  }),
  /** The check as it runs for this event. */
  effective: z.object(settingsShape),
});
export type EventContentCheckResponse = z.infer<typeof eventContentCheckResponseSchema>;

export const contentCheckVerdictSchema = z.object({
  outcome: contentCheckOutcomeSchema,
  flags: z.array(
    z.object({ id: z.string(), probabilityPercent: z.number(), blocking: z.boolean(), message: z.string() }),
  ),
  scores: z.array(z.object({ id: z.string(), label: z.string(), percent: z.number(), level: z.string() })),
  scorePercent: z.number().nullable(),
});
export type ContentCheckVerdictPayload = z.infer<typeof contentCheckVerdictSchema>;

/** A trial: the check run on sample text with settings that need not be saved. */
export const contentCheckTrialInputSchema = z.object({
  text: trimmedString(1, 20000, "Enter text to check."),
  title: z.string().trim().max(300).default(""),
  model: contentCheckModelSchema,
  context: contextSchema,
  questions: questionsSchema.refine((questions) => questions.length > 0, { message: "Add a question." }),
});
export type ContentCheckTrialInput = z.infer<typeof contentCheckTrialInputSchema>;

export const contentCheckTrialResponseSchema = z.object({
  verdict: contentCheckVerdictSchema,
  model: contentCheckModelSchema.nullable(),
  latencyMs: z.number().int(),
  /** The answer to every question, raised or not, for tuning. */
  answers: z.array(z.object({ id: z.string(), percent: z.number() })),
});
export type ContentCheckTrialResponse = z.infer<typeof contentCheckTrialResponseSchema>;

/** A stored check of one piece of content, as reviewers and moderators see it. */
export const contentCheckResultSchema = contentCheckVerdictSchema.extend({
  model: contentCheckModelSchema.nullable(),
  latencyMs: z.number().int(),
  checkedAt: utcInstantSchema,
});
export type ContentCheckResult = z.infer<typeof contentCheckResultSchema>;

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
export const contentCheckSavedResponseSchema = z.object({ success: z.literal(true), revision: z.number().int() });

export const contentChecksListRouteSchema = {
  tags: ["Content checks"],
  summary: "List the PKIC-wide automatic checks",
  responses: {
    "200": { description: "Every check.", content: routeJson(contentCheckSettingsListResponseSchema) },
    ...routeRefusals,
  },
  ...staffAuth,
};
export const contentCheckSettingsPutRouteSchema = {
  tags: ["Content checks"],
  summary: "Change a PKIC-wide automatic check",
  request: {
    params: contentCheckKindParamsSchema,
    body: { required: true, content: routeJson(contentCheckSettingsInputSchema) },
  },
  responses: {
    "200": { description: "Saved.", content: routeJson(contentCheckSavedResponseSchema) },
    ...routeRefusals,
  },
  ...staffAuth,
};
export const contentCheckTrialRouteSchema = {
  tags: ["Content checks"],
  summary: "Try an automatic check on sample text",
  request: {
    params: contentCheckKindParamsSchema,
    body: { required: true, content: routeJson(contentCheckTrialInputSchema) },
  },
  responses: {
    "200": { description: "The verdict.", content: routeJson(contentCheckTrialResponseSchema) },
    ...routeRefusals,
  },
  ...staffAuth,
};
export const eventContentCheckGetRouteSchema = {
  tags: ["Content checks"],
  summary: "Get an automatic check as it runs for an event",
  request: { params: eventContentCheckKindParamsSchema },
  responses: {
    "200": { description: "The check.", content: routeJson(eventContentCheckResponseSchema) },
    ...routeRefusals,
  },
  ...eventReaderAuth,
};
export const eventContentCheckPutRouteSchema = {
  tags: ["Content checks"],
  summary: "Change what an event adds to an automatic check",
  request: {
    params: eventContentCheckKindParamsSchema,
    body: { required: true, content: routeJson(contentCheckEventAdditionsInputSchema) },
  },
  responses: {
    "200": { description: "Saved.", content: routeJson(contentCheckSavedResponseSchema) },
    ...routeRefusals,
  },
  ...eventOrganizerAuth,
};
export const eventContentCheckTrialRouteSchema = {
  tags: ["Content checks"],
  summary: "Try an event's automatic check on sample text",
  request: {
    params: eventContentCheckKindParamsSchema,
    body: { required: true, content: routeJson(contentCheckTrialInputSchema) },
  },
  responses: {
    "200": { description: "The verdict.", content: routeJson(contentCheckTrialResponseSchema) },
    ...routeRefusals,
  },
  ...eventOrganizerAuth,
};
