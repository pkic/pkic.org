import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { eventSlugParamsSchema, successResponseSchema } from "./api-common";
import { formFieldOptionsSchema, formFieldRulesSchema } from "./form-field-rules";
import { addDuplicateStringIssues } from "./refinements";
import { proposalTypeSchema } from "./proposal-management";
import { eventDayReadModelSchema, eventSummarySchema, requiredTermSchema } from "./event-read-models";
import { groupIdSchema } from "./groups";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export {
  eventAttendanceOptionSchema,
  eventDayReadModelSchema,
  eventSummarySchema,
  requiredTermSchema,
} from "./event-read-models";
export type { EventDayReadModel, EventSummary, RequiredTerm } from "./event-read-models";

export const FORM_PURPOSES = [
  "event_registration",
  "proposal_submission",
  "survey",
  "feedback",
  "application",
] as const;
export const formPurposeSchema = z.enum(FORM_PURPOSES);
export type FormPurpose = z.infer<typeof formPurposeSchema>;

export const EVENT_FORM_PURPOSES = ["event_registration", "proposal_submission"] as const;
export const eventFormsPurposeSchema = z.enum(EVENT_FORM_PURPOSES);
export type EventFormsPurpose = z.infer<typeof eventFormsPurposeSchema>;

export const FORM_STATUSES = ["active", "inactive", "archived"] as const;
export const formStatusSchema = z.enum(FORM_STATUSES);
export type FormStatus = z.infer<typeof formStatusSchema>;

export const FORM_FIELD_TYPES = [
  "text",
  "textarea",
  "select",
  "multi_select",
  "boolean",
  "number",
  "date",
  "email",
  "url",
] as const;
export const formFieldTypeSchema = z.enum(FORM_FIELD_TYPES);
export type FormFieldType = z.infer<typeof formFieldTypeSchema>;

/** Canonical form-authoring field input shared by every management context. */
export const formFieldInputSchema = z.object({
  id: databaseIdSchema.optional(),
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(200),
  fieldType: formFieldTypeSchema,
  required: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  options: formFieldOptionsSchema.optional(),
  validation: formFieldRulesSchema.optional(),
});

function addDuplicateFormFieldIssues(value: { fields?: Array<{ key: string }> }, context: z.RefinementCtx): void {
  addDuplicateStringIssues(value.fields ?? [], context, {
    value: (field) => field.key,
    path: (index) => ["fields", index, "key"],
    label: "Field key",
  });
}

/** Canonical editable form definition; placement ownership is supplied by the route context. */
export const formDefinitionCreateSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z][a-z0-9-]*$/),
    purpose: formPurposeSchema,
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().min(2).max(1000).optional(),
    status: formStatusSchema.default("active"),
    fields: z.array(formFieldInputSchema).max(50).default([]),
  })
  .superRefine(addDuplicateFormFieldIssues);

export const formDefinitionUpdateSchema = z
  .object({
    title: z.string().trim().min(2).max(200).optional(),
    description: z.string().trim().min(2).max(1000).nullable().optional(),
    status: formStatusSchema.optional(),
    fields: z.array(formFieldInputSchema).max(50).optional(),
  })
  .superRefine(addDuplicateFormFieldIssues);

export type FormDefinitionCreateInput = z.infer<typeof formDefinitionCreateSchema>;
export type FormDefinitionUpdateInput = z.infer<typeof formDefinitionUpdateSchema>;

/** Canonical form-field read model shared by API responses and frontends. */
export const formFieldDefinitionSchema = z.object({
  id: databaseIdSchema,
  key: z.string(),
  label: z.string(),
  fieldType: formFieldTypeSchema,
  required: z.boolean(),
  options: formFieldOptionsSchema.nullable(),
  validation: formFieldRulesSchema.nullable(),
  sortOrder: z.number(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
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

export const FORM_PLACEMENT_CONTEXT_TYPES = ["installation", "group", "event", "organization"] as const;
export const formPlacementContextTypeSchema = z.enum(FORM_PLACEMENT_CONTEXT_TYPES);
export const formPlacementSchema = z.object({
  id: databaseIdSchema,
  formId: databaseIdSchema,
  ownerGroupId: groupIdSchema.nullable(),
  contextType: formPlacementContextTypeSchema,
  contextRef: z.string().nullable(),
  audience: z.string().trim().min(1).max(100),
  active: z.boolean(),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FormPlacement = z.infer<typeof formPlacementSchema>;
const formPlacementInputShape = {
  ownerGroupId: groupIdSchema.nullable(),
  contextType: formPlacementContextTypeSchema,
  contextRef: z.string().trim().min(1).max(200).nullable(),
  audience: z.string().trim().min(1).max(100),
  active: z.boolean(),
  opensAt: z.iso.datetime().nullable().optional(),
  closesAt: z.iso.datetime().nullable().optional(),
};

function addPlacementIssues(
  placement: {
    contextType?: FormPlacement["contextType"];
    contextRef?: string | null;
    opensAt?: string | null;
    closesAt?: string | null;
  },
  context: z.RefinementCtx,
): void {
  if (placement.contextType === "installation" && placement.contextRef !== undefined && placement.contextRef !== null) {
    context.addIssue({
      code: "custom",
      path: ["contextRef"],
      message: "Installation placements cannot have a context reference",
    });
  }
  if (placement.contextType && placement.contextType !== "installation" && placement.contextRef === null) {
    context.addIssue({ code: "custom", path: ["contextRef"], message: "This placement context requires a reference" });
  }
  if (placement.opensAt && placement.closesAt && placement.opensAt >= placement.closesAt) {
    context.addIssue({ code: "custom", path: ["closesAt"], message: "Closing time must be after opening time" });
  }
}

export const formPlacementCreateSchema = z
  .object(formPlacementInputShape)
  .extend({
    ownerGroupId: formPlacementInputShape.ownerGroupId.default(null),
    contextRef: formPlacementInputShape.contextRef.default(null),
    active: formPlacementInputShape.active.default(true),
  })
  .superRefine(addPlacementIssues);
export const formPlacementUpdateSchema = z.object(formPlacementInputShape).partial().superRefine(addPlacementIssues);
export const formPlacementPolicyUpdateSchema = z
  .strictObject(formPlacementInputShape)
  .omit({ ownerGroupId: true })
  .partial()
  .superRefine(addPlacementIssues);
export const formPlacementsListQuerySchema = listQuerySchema(["audience", "opens_at", "created_at"] as const).extend({
  ownerGroupId: groupIdSchema.optional(),
  contextType: formPlacementContextTypeSchema.optional(),
  contextRef: z.string().trim().min(1).max(200).optional(),
  active: z.enum(["true", "false"]).optional(),
});
export const formPlacementsListResponseSchema = paginatedResponseSchema("placements", formPlacementSchema);
export const formPlacementCreateResponseSchema = successResponseSchema.extend({ placement: formPlacementSchema });
export type FormPlacementCreateInput = z.infer<typeof formPlacementCreateSchema>;
export type FormPlacementUpdateInput = z.infer<typeof formPlacementUpdateSchema>;
export type FormPlacementsListQuery = z.infer<typeof formPlacementsListQuerySchema>;

export const eventAudienceSchema = z.enum(["attendee", "speaker"]);

export const eventFormsQuerySchema = z.object({
  purpose: eventFormsPurposeSchema.default("event_registration"),
});

export const eventFormsResponseSchema = z.object({
  event: eventSummarySchema,
  purpose: eventFormsPurposeSchema,
  form: activeFormSummarySchema.extend({ key: z.string() }).nullable(),
  requiredTerms: z.array(requiredTermSchema),
  allowedSessionTypes: z.array(proposalTypeSchema).max(20),
  eventDays: z.array(eventDayReadModelSchema),
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

export type EventFormsResponse = z.infer<typeof eventFormsResponseSchema>;
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
