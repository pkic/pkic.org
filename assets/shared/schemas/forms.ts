import { z } from "zod";
import { databaseIdSchema } from "./identifiers";

/** Canonical form-field read model shared by API responses and frontends. */
export const formFieldDefinitionSchema = z.object({
  id: databaseIdSchema,
  key: z.string(),
  label: z.string(),
  fieldType: z.string(),
  required: z.boolean(),
  options: z.unknown().nullable(),
  validation: z.unknown().nullable(),
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
