import { all, first } from "../../db/queries";
import { parseJsonSafe } from "../../utils/json";
import type { DatabaseLike } from "../../types";
import type {
  FormFieldDefinition,
  FormFieldType,
  FormPurpose,
  FormStatus,
} from "../../../../assets/shared/schemas/forms";
import { parseFormFieldOptions, parseFormFieldRules } from "../../../../assets/shared/schemas/form-field-rules";

export type { FormFieldDefinition, FormPurpose } from "../../../../assets/shared/schemas/forms";

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

interface EventSettings {
  forms?: {
    event_registration?: string | null;
    proposal_submission?: string | null;
  };
}

export interface FormFieldRow {
  id: string;
  key: string;
  label: string;
  field_type: FormFieldType;
  required: number;
  options_json: string | null;
  validation_json: string | null;
  sort_order: number;
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
  title: string;
  description: string | null;
  fields: FormFieldDefinition[];
}

const FORM_COLUMNS = "id, key, scope_type, scope_ref, purpose, status, title, description";
const FORM_FIELD_COLUMNS = "id, key, label, field_type, required, options_json, validation_json, sort_order";

async function loadFormFieldRows(db: DatabaseLike, formId: string): Promise<FormFieldRow[]> {
  return all<FormFieldRow>(
    db,
    `SELECT ${FORM_FIELD_COLUMNS}
     FROM form_fields
     WHERE form_id = ?
     ORDER BY sort_order ASC, key ASC`,
    [formId],
  );
}

export function mapManagedFormFields(fields: FormFieldRow[]) {
  return fields.map((entry) => ({
    id: entry.id,
    key: entry.key,
    label: entry.label,
    fieldType: entry.field_type,
    required: entry.required === 1,
    options: parseFormFieldOptions(parseJsonSafe<unknown>(entry.options_json, null)),
    validation: parseFormFieldRules(parseJsonSafe<unknown>(entry.validation_json, null)),
    sortOrder: entry.sort_order,
  }));
}

export async function getManagedFormWithFields(
  db: DatabaseLike,
  formKey: string,
): Promise<ManagedFormWithFields | null> {
  const form = await first<ManagedFormWithFields["form"]>(
    db,
    `SELECT ${FORM_COLUMNS}, created_at, updated_at FROM forms WHERE key = ?`,
    [formKey],
  );
  if (!form) return null;
  return { form, fields: await loadFormFieldRows(db, form.id) };
}

async function findActiveForm(db: DatabaseLike, eventId: string, purpose: FormPurpose): Promise<FormRow | null> {
  const event = await first<{ settings_json: string }>(db, "SELECT settings_json FROM events WHERE id = ?", [eventId]);
  if (event) {
    const settings = parseJsonSafe<EventSettings>(event.settings_json, {});
    const linkedKey = settings.forms?.[purpose as keyof NonNullable<EventSettings["forms"]>];
    if (linkedKey === null) {
      return null;
    }
    if (typeof linkedKey === "string" && linkedKey) {
      const linked = await first<FormRow>(
        db,
        `SELECT ${FORM_COLUMNS}
         FROM forms
         WHERE status = 'active' AND purpose = ? AND key = ?
         LIMIT 1`,
        [purpose, linkedKey],
      );
      if (linked) {
        return linked;
      }
    }
  }

  const eventScoped = await first<FormRow>(
    db,
    `SELECT ${FORM_COLUMNS}
     FROM forms
     WHERE status = 'active' AND purpose = ? AND scope_type = 'event' AND scope_ref = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    [purpose, eventId],
  );
  if (eventScoped) {
    return eventScoped;
  }

  return first<FormRow>(
    db,
    `SELECT ${FORM_COLUMNS}
     FROM forms
     WHERE status = 'active' AND purpose = ? AND scope_type = 'global'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [purpose],
  );
}

async function loadFormDefinition(db: DatabaseLike, form: FormRow | null): Promise<ActiveFormDefinition | null> {
  if (!form) return null;
  const fields = await loadFormFieldRows(db, form.id);

  return {
    id: form.id,
    key: form.key,
    scopeType: form.scope_type,
    scopeRef: form.scope_ref,
    purpose: form.purpose,
    title: form.title,
    description: form.description,
    fields: mapManagedFormFields(fields),
  };
}

export async function getActiveFormByPurpose(
  db: DatabaseLike,
  eventId: string,
  purpose: FormPurpose,
): Promise<ActiveFormDefinition | null> {
  return loadFormDefinition(db, await findActiveForm(db, eventId, purpose));
}

/**
 * Resolves the active global (non-event-scoped) form for a given `forms.key`
 * — used by forms like the membership application that aren't tied
 * to an event, so the `findActiveForm` event-scoping logic above doesn't apply.
 */
export async function getGlobalFormByKey(db: DatabaseLike, key: string): Promise<ActiveFormDefinition | null> {
  const form = await first<FormRow>(
    db,
    `SELECT ${FORM_COLUMNS} FROM forms WHERE status = 'active' AND scope_type = 'global' AND key = ? LIMIT 1`,
    [key],
  );
  return loadFormDefinition(db, form);
}
