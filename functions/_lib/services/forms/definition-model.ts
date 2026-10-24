import type {
  FormFieldDefinition,
  FormPlacement,
  FormFieldType,
  FormPurpose,
  FormStatus,
} from "../../../../assets/shared/schemas/forms";

export interface FormRow {
  id: string;
  key: string;
  scope_type: string;
  scope_ref: string | null;
  purpose: FormPurpose;
  status: FormStatus;
  title: string;
  description: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface FormFieldRow {
  id: string;
  key: string;
  label: string;
  field_type: FormFieldType;
  required: number;
  options_json: string | null;
  option_source: string | null;
  validation_json: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string | null;
  archived_at: string | null;
}

export interface ManagedFormWithFields {
  form: FormRow & { created_at: string; updated_at: string };
  fields: FormFieldRow[];
}

export interface ActiveFormDefinition {
  id: string;
  key: string;
  scopeType: string;
  scopeRef: string | null;
  purpose: FormPurpose;
  status: FormStatus;
  title: string;
  description: string | null;
  formUpdatedAt: string;
  placement: FormPlacement | null;
  fields: FormFieldDefinition[];
}

export const FORM_COLUMNS = "id, key, scope_type, scope_ref, purpose, status, title, description";
