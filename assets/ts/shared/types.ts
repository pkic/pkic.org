import type { FormFieldDefinition } from "../../shared/schemas/forms";

export type { EventFormsResponse, RequiredTerm } from "../../shared/schemas/forms";
export type { ProposalManageResponse } from "../../shared/schemas/proposal-management";
export type { RegistrationManageReadResponse as RegistrationManageResponse } from "../../shared/schemas/registration";

export type FormField = Omit<FormFieldDefinition, "id" | "updatedAt" | "archivedAt"> & {
  id?: FormFieldDefinition["id"];
  updatedAt?: FormFieldDefinition["updatedAt"];
  archivedAt?: FormFieldDefinition["archivedAt"];
};

export interface FormDefinition {
  id: string;
  key: string;
  title: string;
  description: string | null;
  fields: FormField[];
}
