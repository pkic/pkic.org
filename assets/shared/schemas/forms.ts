import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { eventSlugParamsSchema } from "./api-common";
import { formFieldOptionsSchema, formFieldRulesSchema } from "./form-field-rules";

/** Canonical form-field read model shared by API responses and frontends. */
export const formFieldDefinitionSchema = z.object({
  id: databaseIdSchema,
  key: z.string(),
  label: z.string(),
  fieldType: z.string(),
  required: z.boolean(),
  options: formFieldOptionsSchema.nullable(),
  validation: formFieldRulesSchema.nullable(),
  sortOrder: z.number(),
});

/** The common form projection embedded in registration and proposal detail responses. */
export const activeFormSummarySchema = z.object({
  id: databaseIdSchema,
  title: z.string(),
  description: z.string().nullable(),
  fields: z.array(formFieldDefinitionSchema),
});

export type FormFieldDefinition = z.infer<typeof formFieldDefinitionSchema>;
export type ActiveFormSummary = z.infer<typeof activeFormSummarySchema>;

export const eventFormsPurposeSchema = z.enum(["event_registration", "proposal_submission"]);
export const eventAudienceSchema = z.enum(["attendee", "speaker"]);

export const eventFormsQuerySchema = z.object({
  purpose: eventFormsPurposeSchema.default("event_registration"),
});

export const requiredTermSchema = z.object({
  termKey: z.string(),
  version: z.string(),
  required: z.boolean(),
  contentRef: z.string().nullable(),
  displayText: z.string().nullable().optional(),
  helpText: z.string().nullable().optional(),
});

export const eventAttendanceOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  spotsRemainingPercent: z.number().nullable().optional(),
});

export const eventFormsResponseSchema = z.object({
  event: z.object({
    id: databaseIdSchema,
    slug: z.string(),
    name: z.string(),
  }),
  purpose: eventFormsPurposeSchema,
  form: activeFormSummarySchema.extend({ key: z.string() }).nullable(),
  requiredTerms: z.array(requiredTermSchema),
  allowedSessionTypes: z.array(z.string()),
  eventDays: z.array(
    z.object({
      dayDate: z.string(),
      label: z.string().nullable(),
      inPersonCapacity: z.number().nullable(),
      sortOrder: z.number(),
      attendanceOptions: z.array(eventAttendanceOptionSchema),
    }),
  ),
});

export const eventTermsQuerySchema = z.object({ audience: eventAudienceSchema.default("attendee") });
export const eventTermsResponseSchema = z.object({
  event: eventFormsResponseSchema.shape.event,
  audience: eventAudienceSchema,
  terms: z.array(requiredTermSchema),
});

export const eventTermsGetRouteSchema = {
  tags: ["Events"],
  summary: "Get event terms",
  description: "Returns the required terms and conditions for a given event.",
  request: { params: eventSlugParamsSchema, query: eventTermsQuerySchema },
  responses: {
    "200": {
      description: "Returns the terms.",
      content: { "application/json": { schema: eventTermsResponseSchema } },
    },
  },
};

export type EventFormsPurpose = z.infer<typeof eventFormsPurposeSchema>;
export type EventFormsResponse = z.infer<typeof eventFormsResponseSchema>;
export type RequiredTerm = z.infer<typeof requiredTermSchema>;

export const eventFormsGetRouteSchema = {
  tags: ["Events"],
  summary: "Get an event form",
  description: "Returns one event form, its terms, session types, and configurable attendance options.",
  request: {
    params: eventSlugParamsSchema,
    query: eventFormsQuerySchema,
  },
  responses: {
    "200": {
      description: "The event form configuration.",
      content: { "application/json": { schema: eventFormsResponseSchema } },
    },
    "400": { description: "Invalid form purpose." },
    "404": { description: "Event not found." },
  },
};
