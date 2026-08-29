import { all, first } from "../../db/queries";
import { AppError, isAppError } from "../../errors";
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

/** Resolve one form through its event ownership or an unowned event placement. */
export async function requireManagedEventForm(
  db: DatabaseLike,
  eventId: string,
  formKey: string,
  options: { ownedOnly?: boolean } = {},
): Promise<ManagedFormWithFields> {
  const aggregate = await getManagedFormWithFields(db, formKey);
  if (!aggregate) throw new AppError(404, "FORM_NOT_FOUND", `Form '${formKey}' not found`);
  const related = await first<{ found: number }>(
    db,
    `SELECT 1 AS found
       FROM forms form
      WHERE form.id = ?
        AND (
          (form.scope_type = 'event' AND form.scope_ref = ?)
          OR (? = 0 AND EXISTS (
            SELECT 1
              FROM form_placements placement
             WHERE placement.form_id = form.id
               AND placement.owner_group_id IS NULL
               AND placement.context_type = 'event'
               AND placement.context_ref = ?
          ))
        )
      LIMIT 1`,
    [aggregate.form.id, eventId, options.ownedOnly ? 1 : 0, eventId],
  );
  if (!related) throw new AppError(404, "FORM_NOT_FOUND", `Form '${formKey}' not found for this event`);
  return aggregate;
}

type EventPlacementOwnershipPolicy = "legacy" | "portal_owner";

type PlacedEventFormRow = FormRow & {
  updated_at: string;
  placement_id: string;
  placement_owner_group_id: string | null;
  event_owner_group_id: string | null;
};

/**
 * Finds a currently open exact placement. Hugo compatibility may use any
 * historic event placement; portal events must use the event owner's group
 * form and fail closed for malformed records.
 */
async function findPlacedEventForm(
  db: DatabaseLike,
  eventId: string,
  purpose: FormPurpose,
  key?: string,
  ownership: EventPlacementOwnershipPolicy = "legacy",
): Promise<{ form: FormRow & { updated_at: string }; placement: FormPlacement } | null> {
  const rows = await all<PlacedEventFormRow>(
    db,
    `SELECT ${FORM_COLUMNS.split(", ")
      .map((column) => `f.${column}`)
      .join(", ")},
            f.updated_at, fp.id AS placement_id,
            fp.owner_group_id AS placement_owner_group_id,
            event.owner_group_id AS event_owner_group_id
     FROM form_placements fp
     JOIN forms f ON f.id = fp.form_id
     JOIN events event ON event.id = fp.context_ref
     WHERE fp.context_type = 'event'
       AND fp.context_ref = ?
       AND fp.active = 1
       AND f.status = 'active'
       AND f.purpose = ?
       ${ownership === "portal_owner" ? "AND event.source_mode = 'portal'" : ""}
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
  if (
    ownership === "portal_owner" &&
    (!row.event_owner_group_id ||
      row.placement_owner_group_id !== row.event_owner_group_id ||
      row.scope_type !== "community" ||
      row.scope_ref !== row.event_owner_group_id)
  ) {
    return null;
  }
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
  options: { includeArchived?: boolean } = {},
): Promise<ActiveFormDefinition | null> {
  if (!resolved) return null;
  const fields = await loadFormFieldRows(db, resolved.form.id, options.includeArchived ?? false);
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
  options: { acceptingResponses?: boolean; includeArchived?: boolean } = {},
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
  return loadFormDefinition(db, placement ? { form: row, placement } : null, options);
}

export async function getActiveFormByPurpose(
  db: DatabaseLike,
  eventId: string,
  purpose: FormPurpose,
): Promise<ActiveFormDefinition | null> {
  return loadFormDefinition(db, await findActiveForm(db, eventId, purpose));
}

/**
 * Resolves only an active event-context placement. Unlike
 * `getActiveFormByPurpose`, this deliberately does not fall back to a linked,
 * event-scoped, or global form. Group-scoped registration must not silently
 * inherit installation configuration that the owning group did not select.
 */
export async function getActiveEventFormByPurpose(
  db: DatabaseLike,
  eventId: string,
  purpose: FormPurpose,
): Promise<ActiveFormDefinition | null> {
  return loadFormDefinition(db, await findPlacedEventForm(db, eventId, purpose));
}

/**
 * Portal event forms are owned by the event's owning group. Do not treat a
 * legacy event/global placement as equivalent merely because its event ID
 * matches: that would let malformed or historical data become a live portal
 * form. Such records fail closed and are repaired through group management.
 */
export async function getActivePortalEventFormByPurpose(
  db: DatabaseLike,
  eventId: string,
  purpose: FormPurpose,
): Promise<ActiveFormDefinition | null> {
  return loadFormDefinition(db, await findPlacedEventForm(db, eventId, purpose, undefined, "portal_owner"));
}

export type EventFormResolution = "public_fallback" | "event_placement";

/** Minimum event projection required to choose the public compatibility policy. */
export interface EventFormResolutionEvent {
  id: string;
  source_mode: string | null;
}

/** Normalizes the nullable database source column before selecting a public flow policy. */
export function toEventFormResolutionEvent(
  event: Pick<EventFormResolutionEvent, "id"> & { source_mode: string | null | undefined },
): EventFormResolutionEvent {
  return { id: event.id, source_mode: event.source_mode ?? null };
}

/**
 * Portal-created events own their event-flow configuration in D1 and must
 * never inherit an older event-settings link or installation form. Hugo and
 * integration records retain the explicit compatibility resolver until their
 * authored configuration is migrated.
 */
export function eventFormResolutionFor(event: EventFormResolutionEvent): EventFormResolution {
  return event.source_mode === "portal" ? "event_placement" : "public_fallback";
}

/** Selects the explicit compatibility policy used by each registration adapter. */
export function getActiveFormForResolution(
  db: DatabaseLike,
  eventId: string,
  purpose: FormPurpose,
  resolution: EventFormResolution,
): Promise<ActiveFormDefinition | null> {
  return resolution === "event_placement"
    ? getActiveEventFormByPurpose(db, eventId, purpose)
    : getActiveFormByPurpose(db, eventId, purpose);
}

/** Central event-aware resolver for every public and self-service event flow. */
export function getActiveFormForEvent(
  db: DatabaseLike,
  event: EventFormResolutionEvent,
  purpose: FormPurpose,
): Promise<ActiveFormDefinition | null> {
  return event.source_mode === "portal"
    ? getActivePortalEventFormByPurpose(db, event.id, purpose)
    : getActiveFormForResolution(db, event.id, purpose, eventFormResolutionFor(event));
}

/**
 * Resolves an active global form only when it has exactly one active
 * installation placement. Global response flows must never create answers
 * without a normalized response-set attribution.
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
  let placement: FormPlacement | null;
  try {
    placement = await findActiveFormPlacement(db, form.id, {
      contextType: "installation",
      contextRef: null,
    });
  } catch (error) {
    if (isAppError(error) && error.code === "FORM_PLACEMENT_REQUIRED") return null;
    throw error;
  }
  if (!placement) return null;
  return loadFormDefinition(db, { form, placement });
}
