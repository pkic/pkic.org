import type { FormFieldDefinition } from "../../shared/schemas/forms";

export type { EventFormsResponse, RequiredTerm } from "../../shared/schemas/forms";
export type { ProposalManageResponse } from "../../shared/schemas/proposal-management";
export type { RegistrationManageReadResponse as RegistrationManageResponse } from "../../shared/schemas/registration";

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    details?: {
      formErrors?: string[];
      fieldErrors?: Record<string, string[]>;
    } | null;
  };
}

export type FormField = Omit<FormFieldDefinition, "id"> & { id?: FormFieldDefinition["id"] };

export interface FormDefinition {
  id: string;
  key: string;
  title: string;
  description: string | null;
  fields: FormField[];
}
