import { all, first } from "../../db/queries";
import { parseJsonSafe } from "../../utils/json";
import type { DatabaseLike, JsonValue } from "../../types";

interface FormRow {
  id: string;
  key: string;
  scope_type: string;
  scope_ref: string | null;
  purpose: string;
  status: string;
  title: string;
  description: string | null;
}

interface EventSettings {
  forms?: {
    event_registration?: string | null;
    proposal_submission?: string | null;
  };
}

interface FormFieldRow {
  id: string;
  key: string;
  label: string;
  field_type: string;
  required: number;
  options_json: string | null;
  validation_json: string | null;
  sort_order: number;
}

export type FormPurpose = "event_registration" | "proposal_submission" | "application";

export interface FormFieldDefinition {
  id: string;
  key: string;
  label: string;
  fieldType: string;
  required: boolean;
  options: JsonValue | null;
  validation: JsonValue | null;
  sortOrder: number;
}

export interface ActiveFormDefinition {
  id: string;
  key: string;
  scopeType: string;
  scopeRef: string | null;
  purpose: string;
  title: string;
  description: string | null;
  fields: FormFieldDefinition[];
}

async function findActiveForm(db: DatabaseLike, eventId: string, purpose: string): Promise<FormRow | null> {
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
        `SELECT *
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
    `SELECT *
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
    `SELECT *
     FROM forms
     WHERE status = 'active' AND purpose = ? AND scope_type = 'global'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [purpose],
  );
}

export async function getActiveFormByPurpose(
  db: DatabaseLike,
  eventId: string,
  purpose: FormPurpose,
): Promise<ActiveFormDefinition | null> {
  const form = await findActiveForm(db, eventId, purpose);
  if (!form) {
    return null;
  }

  const fields = await all<FormFieldRow>(
    db,
    `SELECT id, key, label, field_type, required, options_json, validation_json, sort_order
     FROM form_fields
     WHERE form_id = ?
     ORDER BY sort_order ASC, key ASC`,
    [form.id],
  );

  return {
    id: form.id,
    key: form.key,
    scopeType: form.scope_type,
    scopeRef: form.scope_ref,
    purpose: form.purpose,
    title: form.title,
    description: form.description,
    fields: fields.map((entry) => ({
      id: entry.id,
      key: entry.key,
      label: entry.label,
      fieldType: entry.field_type,
      required: entry.required === 1,
      options: parseJsonSafe<JsonValue | null>(entry.options_json, null),
      validation: parseJsonSafe<JsonValue | null>(entry.validation_json, null),
      sortOrder: entry.sort_order,
    })),
  };
}

/**
 * Resolves the active global (non-event-scoped) form for a given `forms.key`
 * — used by forms like the membership application (§1.4) that aren't tied
 * to an event, so the `findActiveForm` event-scoping logic above doesn't apply.
 */
export async function getGlobalFormByKey(db: DatabaseLike, key: string): Promise<ActiveFormDefinition | null> {
  const form = await first<FormRow>(
    db,
    `SELECT * FROM forms WHERE status = 'active' AND scope_type = 'global' AND key = ? LIMIT 1`,
    [key],
  );
  if (!form) return null;

  const fields = await all<FormFieldRow>(
    db,
    `SELECT id, key, label, field_type, required, options_json, validation_json, sort_order
     FROM form_fields
     WHERE form_id = ?
     ORDER BY sort_order ASC, key ASC`,
    [form.id],
  );

  return {
    id: form.id,
    key: form.key,
    scopeType: form.scope_type,
    scopeRef: form.scope_ref,
    purpose: form.purpose,
    title: form.title,
    description: form.description,
    fields: fields.map((entry) => ({
      id: entry.id,
      key: entry.key,
      label: entry.label,
      fieldType: entry.field_type,
      required: entry.required === 1,
      options: parseJsonSafe<JsonValue | null>(entry.options_json, null),
      validation: parseJsonSafe<JsonValue | null>(entry.validation_json, null),
      sortOrder: entry.sort_order,
    })),
  };
}
