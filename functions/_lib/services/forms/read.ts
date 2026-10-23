import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { placedEventFormSelection, decodePlacedEventForm, type PlacedEventFormRow } from "./event-placement-read";
import {
  FORM_COLUMNS,
  type FormRow,
  type FormFieldRow,
  type ManagedFormWithFields,
  type ActiveFormDefinition,
} from "./definition-model";
export type { FormRow, FormFieldRow, ManagedFormWithFields, ActiveFormDefinition } from "./definition-model";
import { batchFirst, batchRows } from "../../db/pagination";
import { AppError, isAppError } from "../../errors";
import { parseJsonSafe } from "../../utils/json";
import type { DatabaseLike, D1StatementResult } from "../../types";
import type { FormPlacement, FormFieldOptionSource, FormPurpose } from "../../../../assets/shared/schemas/forms";
import {
  parseFormFieldOptions,
  parseFormFieldRules,
  type FormFieldOption,
} from "../../../../assets/shared/schemas/form-field-rules";
import { FORM_FIELD_OPTION_SOURCES } from "../../../../assets/shared/schemas/forms";
import {
  FORM_PLACEMENT_COLUMNS,
  mapFormPlacement,
  type FormPlacementRow,
  prepareFormPlacementRead,
} from "./placements";

export type { FormFieldDefinition, FormPurpose } from "../../../../assets/shared/schemas/forms";

const FORM_FIELD_COLUMNS =
  "id, key, label, field_type, required, options_json, option_source, validation_json, sort_order, created_at, updated_at, archived_at";

function prepareFormFields(db: DatabaseLike, formIdsSql: string, bindings: unknown[], includeArchived = false) {
  return db
    .prepare(
      `SELECT ${FORM_FIELD_COLUMNS} FROM form_fields WHERE form_id IN (${formIdsSql})${includeArchived ? "" : " AND archived_at IS NULL"} ORDER BY sort_order ASC,key ASC`,
    )
    .bind(...bindings);
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

interface OptionCatalogRow {
  value: string;
  label: string;
  active: number;
}
function prepareOptionCatalog(
  db: DatabaseLike,
  source: FormFieldOptionSource,
  includeInactive: boolean,
  fieldSelection?: { sql: string; bindings: unknown[]; includeArchived?: boolean },
) {
  switch (source) {
    case "active_working_groups":
      return db
        .prepare(
          `SELECT id AS value,name AS label,active FROM groups WHERE type_key='working_group'${includeInactive ? "" : " AND active=1"}${fieldSelection ? ` AND EXISTS(SELECT 1 FROM form_fields WHERE form_id IN (${fieldSelection.sql}) AND option_source=?${fieldSelection.includeArchived ? "" : " AND archived_at IS NULL"})` : ""} ORDER BY name COLLATE NOCASE ASC,id ASC`,
        )
        .bind(...(fieldSelection ? [...fieldSelection.bindings, source] : []));
  }
}
function decodeOptionCatalog(rows: OptionCatalogRow[]): FormFieldOption[] {
  return rows.map((row) => ({ value: row.value, label: row.label, active: row.active === 1 }));
}
async function loadOptionCatalog(
  db: DatabaseLike,
  source: FormFieldOptionSource,
  includeInactive: boolean,
): Promise<FormFieldOption[]> {
  return decodeOptionCatalog((await prepareOptionCatalog(db, source, includeInactive).all<OptionCatalogRow>()).results);
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

function prepareManagedFormWithFields(db: DatabaseLike, formKey: string) {
  return {
    statements: [
      db.prepare(`SELECT ${FORM_COLUMNS}, created_at, updated_at FROM forms WHERE key = ?`).bind(formKey),
      prepareFormFields(db, "SELECT id FROM forms WHERE key = ?", [formKey], true),
    ],
    decode(results: D1StatementResult[]): ManagedFormWithFields | null {
      const form = batchFirst<ManagedFormWithFields["form"]>(results[0]);
      return form ? { form, fields: batchRows<FormFieldRow>(results[1]) } : null;
    },
  };
}

export async function getManagedFormWithFields(
  db: DatabaseLike,
  formKey: string,
): Promise<ManagedFormWithFields | null> {
  const read = prepareManagedFormWithFields(db, formKey);
  return read.decode(await db.batch(read.statements));
}

/** Resolve one form through its event ownership or an unowned event placement. */
export function prepareManagedEventForm(
  db: DatabaseLike,
  event: EventReadSelection,
  formKey: string,
  options: { ownedOnly?: boolean } = {},
) {
  const aggregate = prepareManagedFormWithFields(db, formKey);
  const eventId = eventReadIdSql(event);
  return {
    statements: [
      ...aggregate.statements,
      db
        .prepare(`SELECT 1 AS found
         FROM forms form
        WHERE form.key = ?
          AND (
            (form.scope_type = 'event' AND form.scope_ref = ${eventId.sql})
            OR (? = 0 AND EXISTS (
              SELECT 1 FROM form_placements placement
               WHERE placement.form_id = form.id
                 AND placement.owner_group_id IS NULL
                 AND placement.context_type = 'event'
                 AND placement.context_ref = ${eventId.sql}
            ))
          )
        LIMIT 1`)
        .bind(formKey, ...eventId.bindings, options.ownedOnly ? 1 : 0, ...eventId.bindings),
    ],
    decode(results: D1StatementResult[]): ManagedFormWithFields {
      const loaded = aggregate.decode(results);
      if (!loaded) throw new AppError(404, "FORM_NOT_FOUND", `Form '${formKey}' not found`);
      if (!batchFirst<{ found: number }>(results[aggregate.statements.length])) {
        throw new AppError(404, "FORM_NOT_FOUND", `Form '${formKey}' not found for this event`);
      }
      return loaded;
    },
  };
}

export async function requireManagedEventForm(
  db: DatabaseLike,
  eventId: string,
  formKey: string,
  options: { ownedOnly?: boolean } = {},
): Promise<ManagedFormWithFields> {
  const read = prepareManagedEventForm(db, eventId, formKey, options);
  return read.decode(await db.batch(read.statements));
}

/** Exact event selection, fields, and catalogs share one consistent D1 batch. */
export function preparePlacedEventFormDefinition(db: DatabaseLike, event: EventReadSelection, purpose: FormPurpose) {
  const selection = placedEventFormSelection(event, purpose);
  const fields = prepareFormDefinitionFields(db, `SELECT definition_id FROM (${selection.sql})`, selection.bindings);
  return {
    statements: [db.prepare(selection.sql).bind(...selection.bindings), ...fields.statements],
    decode(results: D1StatementResult[]) {
      const resolved = decodePlacedEventForm(batchRows<PlacedEventFormRow>(results[0]));
      return resolved ? decodeFormDefinition(resolved, ...fields.decode(results.slice(1))) : null;
    },
  };
}

function prepareFormDefinitionFields(
  db: DatabaseLike,
  formIdsSql: string,
  bindings: unknown[],
  options: { includeArchived?: boolean } = {},
) {
  return {
    statements: [
      prepareFormFields(db, formIdsSql, bindings, options.includeArchived ?? false),
      ...FORM_FIELD_OPTION_SOURCES.map((source) =>
        prepareOptionCatalog(db, source, false, {
          sql: formIdsSql,
          bindings,
          includeArchived: options.includeArchived,
        }),
      ),
    ],
    decode(results: D1StatementResult[]): [FormFieldRow[], OptionCatalogs] {
      return [
        batchRows<FormFieldRow>(results[0]),
        Object.fromEntries(
          FORM_FIELD_OPTION_SOURCES.map((source, index) => [
            source,
            decodeOptionCatalog(batchRows<OptionCatalogRow>(results[1 + index])),
          ]),
        ),
      ];
    },
  };
}

function decodeFormDefinition(
  resolved: { form: FormRow & { updated_at: string }; placement: FormPlacement | null },
  fields: FormFieldRow[],
  catalogs: OptionCatalogs,
): ActiveFormDefinition {
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

/**
 * Resolves one placement without inferring ownership from its reusable
 * definition.
 *
 * `forSubmission` narrows the resolution to a form that is live at all — an
 * active definition on an active placement. It deliberately does not filter on
 * the submission window: a form that is merely early or late still exists, and
 * hiding it here would leave the caller with nothing to tell the submitter but
 * that it was not found. The window is refused, with its dates, by
 * `prepareFormSubmissionGuard`.
 */
export function prepareFormDefinitionByPlacement(
  db: DatabaseLike,
  placementId: string,
  options: { forSubmission?: boolean; includeArchived?: boolean } = {},
) {
  const formIdsSql = "SELECT form_id FROM form_placements WHERE id=?";
  const fields = prepareFormDefinitionFields(db, formIdsSql, [placementId], options);
  const statements = [
    db
      .prepare(
        `SELECT ${FORM_COLUMNS.split(", ")
          .map((column) => `f.${column}`)
          .join(
            ", ",
          )},f.updated_at FROM form_placements fp JOIN forms f ON f.id=fp.form_id WHERE fp.id=? ${options.forSubmission ? "AND f.status='active' AND fp.active=1" : ""} LIMIT 1`,
      )
      .bind(placementId),
    db.prepare(`SELECT ${FORM_PLACEMENT_COLUMNS} FROM form_placements WHERE id=?`).bind(placementId),
    ...fields.statements,
  ];
  return {
    statements,
    decode(results: D1StatementResult[]): ActiveFormDefinition | null {
      const form = batchFirst<FormRow & { updated_at: string }>(results[0]);
      const placementRow = batchFirst<FormPlacementRow>(results[1]);
      if (!form || !placementRow) return null;
      return decodeFormDefinition(
        { form, placement: mapFormPlacement(placementRow) },
        ...fields.decode(results.slice(2)),
      );
    },
  };
}

export async function getFormDefinitionByPlacement(
  db: DatabaseLike,
  placementId: string,
  options: { forSubmission?: boolean; includeArchived?: boolean } = {},
): Promise<ActiveFormDefinition | null> {
  const read = prepareFormDefinitionByPlacement(db, placementId, options);
  return read.decode(await db.batch(read.statements));
}

/**
 * One form by id, with no placement.
 *
 * A vote-owned consultation form is not placed on an event or an
 * installation: the vote itself is the context. Everything else about it is an
 * ordinary form, so it resolves through the same projection rather than a
 * second one that would drift from it.
 */
export async function getActiveFormById(db: DatabaseLike, formId: string): Promise<ActiveFormDefinition | null> {
  const fields = prepareFormDefinitionFields(db, "SELECT id FROM forms WHERE id = ? AND status = 'active'", [formId]);
  const [formResult, ...fieldResults] = await db.batch([
    db.prepare(`SELECT ${FORM_COLUMNS}, updated_at FROM forms WHERE id = ? AND status = 'active'`).bind(formId),
    ...fields.statements,
  ]);
  const form = batchFirst<FormRow & { updated_at: string }>(formResult);
  return form ? decodeFormDefinition({ form, placement: null }, ...fields.decode(fieldResults)) : null;
}

/** Resolve a definition only through its active event placement and canonical owner. */
export async function getActiveEventFormByPurpose(
  db: DatabaseLike,
  eventId: string,
  purpose: FormPurpose,
): Promise<ActiveFormDefinition | null> {
  const read = preparePlacedEventFormDefinition(db, eventId, purpose);
  return read.decode(await db.batch(read.statements));
}

/** Event context passed between registration, proposal, and response workflows. */
export interface EventFormResolutionEvent {
  id: string;
  source_mode: string | null;
}

/** Normalizes the nullable event source metadata at the service boundary. */
export function toEventFormResolutionEvent(
  event: Pick<EventFormResolutionEvent, "id"> & { source_mode: string | null | undefined },
): EventFormResolutionEvent {
  return { id: event.id, source_mode: event.source_mode ?? null };
}

/** Every event source uses the same explicit placement query and owner decoder. */
export function prepareEventFormDefinitionRead(
  db: DatabaseLike,
  event: EventFormResolutionEvent,
  purpose: FormPurpose,
) {
  return preparePlacedEventFormDefinition(db, event.id, purpose);
}

/** Event-context adapter for public, management, and self-service event flows. */
export function getActiveFormForEvent(
  db: DatabaseLike,
  event: EventFormResolutionEvent,
  purpose: FormPurpose,
): Promise<ActiveFormDefinition | null> {
  return getActiveEventFormByPurpose(db, event.id, purpose);
}

/**
 * Resolves an active global form only when it has exactly one active
 * installation placement. Global response flows must never create answers
 * without a normalized response-set attribution.
 */
export function prepareGlobalFormDefinition(db: DatabaseLike, key: string) {
  const formSelection = "SELECT id FROM forms WHERE status='active' AND scope_type='global' AND key=? LIMIT 1";
  const fields = prepareFormDefinitionFields(db, formSelection, [key]);
  const placement = prepareFormPlacementRead(db, { key }, { contextType: "installation", contextRef: null }, true);
  return {
    statements: [
      db.prepare(`SELECT ${FORM_COLUMNS}, updated_at FROM forms WHERE id IN (${formSelection})`).bind(key),
      placement.statement,
      ...fields.statements,
    ],
    decode(results: D1StatementResult[]): ActiveFormDefinition | null {
      const form = batchFirst<FormRow & { updated_at: string }>(results[0]);
      if (!form) return null;
      let selected: FormPlacement | null;
      try {
        selected = placement.decode(batchRows<FormPlacementRow>(results[1]));
      } catch (error) {
        if (isAppError(error) && error.code === "FORM_PLACEMENT_REQUIRED") return null;
        throw error;
      }
      return selected ? decodeFormDefinition({ form, placement: selected }, ...fields.decode(results.slice(2))) : null;
    },
  };
}

export async function getGlobalFormByKey(db: DatabaseLike, key: string): Promise<ActiveFormDefinition | null> {
  const read = prepareGlobalFormDefinition(db, key);
  return read.decode(await db.batch(read.statements));
}
