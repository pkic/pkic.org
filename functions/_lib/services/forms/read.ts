import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import { parseJsonSafe } from "../../utils/json";
import type { DatabaseLike } from "../../types";
import type {
  FormFieldDefinition,
  FormPlacement,
  FormFieldType,
  FormFieldOptionSource,
  FormPurpose,
  FormStatus,
} from "../../../../assets/shared/schemas/forms";
import {
  parseFormFieldOptions,
  parseFormFieldRules,
  type FormFieldOption,
} from "../../../../assets/shared/schemas/form-field-rules";
import { FORM_FIELD_OPTION_SOURCES } from "../../../../assets/shared/schemas/forms";
import { defaultFormAudience, findActiveFormPlacement, findFormPlacement } from "./placements";

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

const FORM_COLUMNS = "id, key, scope_type, scope_ref, purpose, status, title, description";
const FORM_FIELD_COLUMNS =
  "id, key, label, field_type, required, options_json, option_source, validation_json, sort_order, created_at, updated_at, archived_at";

async function loadFormFieldRows(db: DatabaseLike, formId: string, includeArchived = false): Promise<FormFieldRow[]> {
  return all<FormFieldRow>(
    db,
    `SELECT ${FORM_FIELD_COLUMNS}
     FROM form_fields
     WHERE form_id = ?${includeArchived ? "" : " AND archived_at IS NULL"}
     ORDER BY sort_order ASC, key ASC`,
    [formId],
  );
}

export function parseFormFieldOptionSource(value: string | null): FormFieldOptionSource | null {
  if (value === null) return null;
  if ((FORM_FIELD_OPTION_SOURCES as readonly string[]).includes(value)) return value as FormFieldOptionSource;
  throw new AppError(500, "FORM_OPTION_SOURCE_UNSUPPORTED", `Unsupported form option source '${value}'`);
}

type OptionCatalogs = Partial<Record<FormFieldOptionSource, FormFieldOption[]>>;

export function mapManagedFormFields(fields: FormFieldRow[], catalogs: OptionCatalogs = {}) {
  return fields.map((entry) => {
    const optionSource = parseFormFieldOptionSource(entry.option_source);
    const options = optionSource
      ? (catalogs[optionSource] ?? null)
      : parseFormFieldOptions(parseJsonSafe<unknown>(entry.options_json, null));
    return {
      id: entry.id,
      key: entry.key,
      label: entry.label,
      fieldType: entry.field_type,
      required: entry.required === 1,
      optionSource,
      options,
      validation: parseFormFieldRules(parseJsonSafe<unknown>(entry.validation_json, null)),
      sortOrder: entry.sort_order,
      updatedAt: entry.updated_at ?? entry.created_at,
      archivedAt: entry.archived_at,
    };
  });
}

async function loadOptionCatalog(
  db: DatabaseLike,
  source: FormFieldOptionSource,
  includeInactive: boolean,
): Promise<FormFieldOption[]> {
  switch (source) {
    case "active_working_groups":
      return all<{ value: string; label: string; active: number }>(
        db,
        `SELECT id AS value, name AS label, active
           FROM groups
          WHERE type_key = 'working_group'${includeInactive ? "" : " AND active = 1"}
          ORDER BY name COLLATE NOCASE ASC, id ASC`,
      ).then((rows) => rows.map((row) => ({ value: row.value, label: row.label, active: row.active === 1 })));
  }
}

export async function resolveFormFieldOptionCatalogs(
  db: DatabaseLike,
  fields: Array<Pick<FormFieldRow, "option_source">>,
  options: { includeInactive?: boolean } = {},
): Promise<OptionCatalogs> {
  const sources = [
    ...new Set(fields.map((field) => parseFormFieldOptionSource(field.option_source)).filter(Boolean)),
  ] as FormFieldOptionSource[];
  const entries = await Promise.all(
    sources.map(
      async (source) => [source, await loadOptionCatalog(db, source, options.includeInactive ?? false)] as const,
    ),
  );
  return Object.fromEntries(entries) as OptionCatalogs;
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
  return { form, fields: await loadFormFieldRows(db, form.id, true) };
}

async function findPlacedEventForm(
  db: DatabaseLike,
  eventId: string,
  purpose: FormPurpose,
  key?: string,
): Promise<{ form: FormRow & { updated_at: string }; placement: FormPlacement } | null> {
  const rows = await all<
    FormRow & {
      updated_at: string;
      placement_id: string;
    }
  >(
    db,
    `SELECT ${FORM_COLUMNS.split(", ")
      .map((column) => `f.${column}`)
      .join(", ")},
            f.updated_at, fp.id AS placement_id
     FROM form_placements fp
     JOIN forms f ON f.id = fp.form_id
     WHERE fp.context_type = 'event'
       AND fp.context_ref = ?
       AND fp.active = 1
       AND f.status = 'active'
       AND f.purpose = ?
       ${purpose === "event_registration" || purpose === "proposal_submission" ? "AND fp.audience = ?" : ""}
       ${key ? "AND f.key = ?" : ""}
       AND (fp.opens_at IS NULL OR unixepoch(fp.opens_at) <= unixepoch())
       AND (fp.closes_at IS NULL OR unixepoch(fp.closes_at) > unixepoch())
     ORDER BY fp.created_at ASC, fp.id ASC
     LIMIT 2`,
    [
      eventId,
      purpose,
      ...(purpose === "event_registration" || purpose === "proposal_submission" ? [defaultFormAudience(purpose)] : []),
      ...(key ? [key] : []),
    ],
  );
  if (rows.length > 1) {
    throw new AppError(503, "FORM_PLACEMENT_AMBIGUOUS", "Multiple active forms are configured for this event flow");
  }
  const row = rows[0];
  if (!row) return null;
  const placement = await findActiveFormPlacement(db, row.id, { placementId: row.placement_id });
  return placement ? { form: row, placement } : null;
}

async function findActiveForm(
  db: DatabaseLike,
  eventId: string,
  purpose: FormPurpose,
): Promise<{ form: FormRow & { updated_at: string }; placement: FormPlacement | null } | null> {
  const event = await first<{ settings_json: string }>(db, "SELECT settings_json FROM events WHERE id = ?", [eventId]);
  if (event) {
    const settings = parseJsonSafe<EventSettings>(event.settings_json, {});
    const linkedKey = settings.forms?.[purpose as keyof NonNullable<EventSettings["forms"]>];
    if (linkedKey === null) {
      return null;
    }
    if (typeof linkedKey === "string" && linkedKey) {
      const placed = await findPlacedEventForm(db, eventId, purpose, linkedKey);
      if (placed) return placed;
      const linked = await first<FormRow & { updated_at: string }>(
        db,
        `SELECT ${FORM_COLUMNS}, updated_at
         FROM forms
         WHERE status = 'active' AND purpose = ? AND key = ?
         LIMIT 1`,
        [purpose, linkedKey],
      );
      if (linked) {
        return { form: linked, placement: null };
      }
    }
  }

  const placed = await findPlacedEventForm(db, eventId, purpose);
  if (placed) return placed;

  const eventScoped = await first<FormRow & { updated_at: string }>(
    db,
    `SELECT ${FORM_COLUMNS}, updated_at
     FROM forms
     WHERE status = 'active' AND purpose = ? AND scope_type = 'event' AND scope_ref = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    [purpose, eventId],
  );
  if (eventScoped) {
    return { form: eventScoped, placement: null };
  }

  const globalForm = await first<FormRow & { updated_at: string }>(
    db,
    `SELECT ${FORM_COLUMNS}, updated_at
     FROM forms
     WHERE status = 'active' AND purpose = ? AND scope_type = 'global'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [purpose],
  );
  if (!globalForm) return null;
  const placement = await findActiveFormPlacement(db, globalForm.id, {
    contextType: "installation",
    contextRef: null,
  });
  return { form: globalForm, placement };
}

async function loadFormDefinition(
  db: DatabaseLike,
  resolved: { form: FormRow & { updated_at: string }; placement: FormPlacement | null } | null,
): Promise<ActiveFormDefinition | null> {
  if (!resolved) return null;
  const fields = await loadFormFieldRows(db, resolved.form.id);
  const catalogs = await resolveFormFieldOptionCatalogs(db, fields);

  return {
    id: resolved.form.id,
    key: resolved.form.key,
    scopeType: resolved.form.scope_type,
    scopeRef: resolved.form.scope_ref,
    purpose: resolved.form.purpose,
    status: resolved.form.status,
    title: resolved.form.title,
    description: resolved.form.description,
    formUpdatedAt: resolved.form.updated_at,
    placement: resolved.placement,
    fields: mapManagedFormFields(fields, catalogs),
  };
}

/** Resolves one placement without inferring ownership from its reusable definition. */
export async function getFormDefinitionByPlacement(
  db: DatabaseLike,
  placementId: string,
  options: { acceptingResponses?: boolean } = {},
): Promise<ActiveFormDefinition | null> {
  const row = await first<FormRow & { updated_at: string; placement_id: string }>(
    db,
    `SELECT ${FORM_COLUMNS.split(", ")
      .map((column) => `f.${column}`)
      .join(", ")},
            f.updated_at, fp.id AS placement_id
       FROM form_placements fp
       JOIN forms f ON f.id = fp.form_id
      WHERE fp.id = ?
        ${options.acceptingResponses ? "AND f.status = 'active' AND fp.active = 1" : ""}
        ${options.acceptingResponses ? "AND (fp.opens_at IS NULL OR unixepoch(fp.opens_at) <= unixepoch())" : ""}
        ${options.acceptingResponses ? "AND (fp.closes_at IS NULL OR unixepoch(fp.closes_at) > unixepoch())" : ""}
      LIMIT 1`,
    [placementId],
  );
  if (!row) return null;
  const placement = options.acceptingResponses
    ? await findActiveFormPlacement(db, row.id, { placementId: row.placement_id })
    : await findFormPlacement(db, row.id, { placementId: row.placement_id });
  return loadFormDefinition(db, placement ? { form: row, placement } : null);
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
  const form = await first<FormRow & { updated_at: string }>(
    db,
    `SELECT ${FORM_COLUMNS}, updated_at
     FROM forms
     WHERE status = 'active' AND scope_type = 'global' AND key = ?
     LIMIT 1`,
    [key],
  );
  if (!form) return null;
  const placement = await findActiveFormPlacement(db, form.id, {
    contextType: "installation",
    contextRef: null,
  });
  return loadFormDefinition(db, { form, placement });
}
