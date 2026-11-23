import {
  formSubmissionSchema,
  formSubmissionsResponseSchema,
  type FormSubmission,
} from "../../../assets/shared/schemas/form-management";
import { formFieldDefinitionSchema, type FormFieldDefinition } from "../../../assets/shared/schemas/forms";

const NOW = "2026-08-31T09:00:00.000Z";

export function field(overrides: Partial<FormFieldDefinition> = {}): FormFieldDefinition {
  return formFieldDefinitionSchema.parse({
    id: "90000000-0000-4000-8000-000000000001",
    key: "priority",
    label: "Priority",
    fieldType: "select",
    required: false,
    options: [
      { value: "high", label: "High" },
      { value: "low", label: "Low" },
    ],
    optionSource: null,
    validation: null,
    sortOrder: 10,
    updatedAt: NOW,
    archivedAt: null,
    ...overrides,
  });
}

export function submission(overrides: Partial<FormSubmission> = {}): FormSubmission {
  return formSubmissionSchema.parse({
    id: "a0000000-0000-4000-8000-000000000001",
    status: "submitted",
    submittedAt: NOW,
    contextType: "group",
    contextRef: null,
    submitter: { id: "ada", organization: null, firstName: "Ada", lastName: "Lovelace", email: "ada@example.test" },
    answers: { priority: "high" },
    ...overrides,
  });
}

export const submissionsSchema = formSubmissionsResponseSchema.pick({ submissions: true, page: true });
