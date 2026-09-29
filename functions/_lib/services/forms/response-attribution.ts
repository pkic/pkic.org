import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import type { FormPlacement, FormPurpose } from "../../../../assets/shared/schemas/forms";
import { defaultFormAudience } from "./placements";
import {
  getActiveFormForEvent,
  mapManagedFormFields,
  resolveFormFieldOptionCatalogs,
  type ActiveFormDefinition,
  type EventFormResolutionEvent,
  type FormFieldRow,
} from "./read";

/** Domain aggregates that retain a compatibility JSON answer projection. */
export type EventFormResponseSource = "registration" | "proposal";

export interface EventFormResponseInput {
  source: EventFormResponseSource;
  sourceId: string;
  event: EventFormResolutionEvent;
  formPlacementId: string | null;
  answersJson: string | null;
}

/**
 * The normalized response set is authoritative whenever the aggregate stores
 * a placement ID. A null form is valid only for a genuinely legacy response
 * without a current compatible definition; a null result means an attributed
 * response was malformed or belongs to another event flow and must not leak.
 */
export interface EventFormResponse {
  form: ActiveFormDefinition | null;
  answers: Record<string, unknown> | null;
  attribution: "stored" | "legacy";
}

interface SubmittedFormRow {
  source_id: string;
  submission_id: string;
  submission_placement_id: string | null;
  form_id: string | null;
  form_key: string | null;
  form_scope_type: string | null;
  form_scope_ref: string | null;
  form_purpose: FormPurpose | null;
  form_status: string | null;
  form_title: string | null;
  form_description: string | null;
  form_updated_at: string | null;
  placement_id: string | null;
  placement_form_id: string | null;
  placement_owner_group_id: string | null;
  placement_context_type: string | null;
  placement_context_ref: string | null;
  placement_audience: string | null;
  placement_active: number | null;
  placement_opens_at: string | null;
  placement_closes_at: string | null;
  placement_created_at: string | null;
  placement_updated_at: string | null;
}

interface SubmissionAnswerRow {
  submission_id: string;
  field_id: string | null;
  form_id: string | null;
  field_key: string | null;
  data_json: string | null;
}

interface HistoricalFormFieldRow extends FormFieldRow {
  form_id: string;
}

const FORM_FIELD_COLUMNS = `id, form_id, key, label, field_type, required, options_json,
  option_source, validation_json, sort_order, created_at, updated_at, archived_at`;

function purposeFor(source: EventFormResponseSource): FormPurpose {
  return source === "registration" ? "event_registration" : "proposal_submission";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAnswers(answersJson: string | null): Record<string, unknown> | null {
  if (!answersJson) return null;
  const parsed = parseJsonSafe<unknown>(answersJson, null);
  return isRecord(parsed) ? parsed : null;
}

function isExpectedStoredSubmission(row: SubmittedFormRow, input: EventFormResponseInput): boolean {
  return (
    row.submission_placement_id === input.formPlacementId &&
    row.placement_id === input.formPlacementId &&
    row.placement_form_id === row.form_id &&
    row.form_id !== null &&
    row.form_key !== null &&
    row.form_scope_type !== null &&
    row.form_purpose === purposeFor(input.source) &&
    row.form_status !== null &&
    row.form_title !== null &&
    row.form_updated_at !== null &&
    row.placement_context_type === "event" &&
    row.placement_context_ref === input.event.id &&
    row.placement_audience === defaultFormAudience(purposeFor(input.source)) &&
    row.placement_active !== null &&
    row.placement_created_at !== null &&
    row.placement_updated_at !== null
  );
}

/**
 * Pre-placement normalized submissions still retain their form identity. They
 * are historical only when the definition is global or belongs to this event;
 * a group/foreign event form cannot be safely inferred from a null placement.
 */
function isExpectedLegacySubmission(row: SubmittedFormRow, input: EventFormResponseInput): boolean {
  return (
    row.submission_placement_id === null &&
    row.form_id !== null &&
    row.form_key !== null &&
    row.form_scope_type !== null &&
    row.form_purpose === purposeFor(input.source) &&
    row.form_status !== null &&
    row.form_title !== null &&
    row.form_updated_at !== null &&
    (row.form_scope_type === "global" || (row.form_scope_type === "event" && row.form_scope_ref === input.event.id))
  );
}

function toPlacement(row: SubmittedFormRow): FormPlacement {
  if (
    !row.placement_id ||
    !row.form_id ||
    !row.placement_context_type ||
    row.placement_context_ref === undefined ||
    !row.placement_audience ||
    row.placement_active === null ||
    !row.placement_created_at ||
    !row.placement_updated_at
  ) {
    throw new Error("Validated event form response row is incomplete");
  }
  return {
    id: row.placement_id,
    formId: row.form_id,
    ownerGroupId: row.placement_owner_group_id,
    contextType: row.placement_context_type as FormPlacement["contextType"],
    contextRef: row.placement_context_ref,
    audience: row.placement_audience,
    active: row.placement_active === 1,
    opensAt: row.placement_opens_at,
    closesAt: row.placement_closes_at,
    createdAt: row.placement_created_at,
    updatedAt: row.placement_updated_at,
  };
}

function toDefinition(
  row: SubmittedFormRow,
  fields: ActiveFormDefinition["fields"],
  placement: FormPlacement | null,
): ActiveFormDefinition {
  if (
    !row.form_id ||
    !row.form_key ||
    !row.form_scope_type ||
    !row.form_purpose ||
    !row.form_status ||
    !row.form_title ||
    !row.form_updated_at
  ) {
    throw new Error("Validated event form response definition is incomplete");
  }
  return {
    id: row.form_id,
    key: row.form_key,
    scopeType: row.form_scope_type,
    scopeRef: row.form_scope_ref,
    purpose: row.form_purpose,
    status: row.form_status as ActiveFormDefinition["status"],
    title: row.form_title,
    description: row.form_description,
    formUpdatedAt: row.form_updated_at,
    placement,
    fields,
  };
}

/**
 * Resolves an already bounded set of responses in four set-based D1 reads:
 * submissions, definitions, fields, and answers. It never looks up a form per
 * aggregate row, so campaign and export callers can preserve historical form
 * attribution without N+1 queries.
 */
export async function resolveEventFormResponses(
  db: DatabaseLike,
  inputs: readonly EventFormResponseInput[],
): Promise<Map<string, EventFormResponse | null>> {
  const resolved = new Map<string, EventFormResponse | null>();
  if (inputs.length === 0) return resolved;

  const source = inputs[0]?.source;
  const eventId = inputs[0]?.event.id;
  if (!source || !eventId || inputs.some((input) => input.source !== source || input.event.id !== eventId)) {
    throw new Error("Event form response batches must use one event and source domain");
  }
  if (new Set(inputs.map((input) => input.sourceId)).size !== inputs.length) {
    throw new Error("Event form response batches require unique source IDs");
  }

  const sourceIds = inputs.map((input) => input.sourceId);
  const sourceFilter = buildD1JsonMembershipFilter("fs.context_ref", sourceIds);
  const submissions = await all<SubmittedFormRow>(
    db,
    `SELECT fs.context_ref AS source_id, fs.id AS submission_id,
            fs.placement_id AS submission_placement_id,
            form.id AS form_id, form.key AS form_key, form.scope_type AS form_scope_type,
            form.scope_ref AS form_scope_ref, form.purpose AS form_purpose,
            form.status AS form_status, form.title AS form_title,
            form.description AS form_description, form.updated_at AS form_updated_at,
            placement.id AS placement_id, placement.form_id AS placement_form_id,
            placement.owner_group_id AS placement_owner_group_id,
            placement.context_type AS placement_context_type,
            placement.context_ref AS placement_context_ref,
            placement.audience AS placement_audience, placement.active AS placement_active,
            placement.opens_at AS placement_opens_at, placement.closes_at AS placement_closes_at,
            placement.created_at AS placement_created_at, placement.updated_at AS placement_updated_at
       FROM form_submissions fs
       LEFT JOIN form_placements placement ON placement.id = fs.placement_id
       LEFT JOIN forms form ON form.id = fs.form_id
      WHERE fs.context_type = ? AND ${sourceFilter.sql}
      ORDER BY fs.context_ref ASC, fs.submitted_at ASC, fs.id ASC`,
    [source, ...sourceFilter.bindings],
  );
  const submissionsBySource = new Map<string, SubmittedFormRow[]>();
  for (const row of submissions) {
    const rows = submissionsBySource.get(row.source_id) ?? [];
    rows.push(row);
    submissionsBySource.set(row.source_id, rows);
  }

  const attributable = new Map<string, { row: SubmittedFormRow; attribution: "stored" | "legacy" }>();
  const legacy = inputs.filter((input) => input.formPlacementId === null);
  for (const input of inputs) {
    const rows = submissionsBySource.get(input.sourceId) ?? [];
    if (input.formPlacementId === null) {
      if (rows.some((row) => row.submission_placement_id !== null)) {
        resolved.set(input.sourceId, null);
        continue;
      }
      const matches = rows.filter((row) => isExpectedLegacySubmission(row, input));
      if (matches.length === 1) {
        attributable.set(input.sourceId, { row: matches[0]!, attribution: "legacy" });
      } else if (rows.length > 0) {
        // A normalized response exists but cannot be attributed safely. Do not
        // replace its historical identity with today's event configuration.
        resolved.set(input.sourceId, null);
      }
      continue;
    }
    const matches = rows.filter((row) => isExpectedStoredSubmission(row, input));
    if (matches.length !== 1) {
      resolved.set(input.sourceId, null);
      continue;
    }
    attributable.set(input.sourceId, { row: matches[0]!, attribution: "stored" });
  }

  const formRows = [...attributable.values()].map((entry) => entry.row);
  const formIds = [...new Set(formRows.map((row) => row.form_id).filter((id): id is string => id !== null))];
  const formFilter = buildD1JsonMembershipFilter("form_id", formIds);
  const fieldRows = formIds.length
    ? await all<HistoricalFormFieldRow>(
        db,
        `SELECT ${FORM_FIELD_COLUMNS}
           FROM form_fields
          WHERE ${formFilter.sql}
          ORDER BY form_id ASC, sort_order ASC, key ASC`,
        formFilter.bindings,
      )
    : [];
  const fieldsByForm = new Map<string, HistoricalFormFieldRow[]>();
  for (const field of fieldRows) {
    const fields = fieldsByForm.get(field.form_id) ?? [];
    fields.push(field);
    fieldsByForm.set(field.form_id, fields);
  }
  const catalogs = await resolveFormFieldOptionCatalogs(db, fieldRows, { includeInactive: true });
  const definitionsBySubmission = new Map<string, ActiveFormDefinition>();
  for (const { row, attribution } of attributable.values()) {
    definitionsBySubmission.set(
      row.submission_id,
      toDefinition(
        row,
        mapManagedFormFields(fieldsByForm.get(row.form_id!) ?? [], catalogs),
        attribution === "stored" ? toPlacement(row) : null,
      ),
    );
  }

  const submissionIds = formRows.map((row) => row.submission_id);
  const answerFilter = buildD1JsonMembershipFilter("answer.submission_id", submissionIds);
  const answerRows = submissionIds.length
    ? await all<SubmissionAnswerRow>(
        db,
        `SELECT answer.submission_id, answer.field_id, field.form_id, field.key AS field_key, answer.data_json
           FROM form_submission_answers answer
           LEFT JOIN form_fields field ON field.id = answer.field_id
          WHERE ${answerFilter.sql}
          ORDER BY answer.submission_id ASC, field.sort_order ASC, field.key ASC`,
        answerFilter.bindings,
      )
    : [];
  const answersBySubmission = new Map<string, Record<string, unknown>>();
  const invalidSubmissions = new Set<string>();
  const expectedFormBySubmission = new Map(formRows.map((row) => [row.submission_id, row.form_id!]));
  for (const answer of answerRows) {
    if (
      !answer.field_id ||
      !answer.form_id ||
      !answer.field_key ||
      answer.form_id !== expectedFormBySubmission.get(answer.submission_id)
    ) {
      invalidSubmissions.add(answer.submission_id);
      continue;
    }
    const answers = answersBySubmission.get(answer.submission_id) ?? {};
    answers[answer.field_key] = parseJsonSafe<unknown>(answer.data_json, null);
    answersBySubmission.set(answer.submission_id, answers);
  }
  for (const [sourceId, { row, attribution }] of attributable) {
    resolved.set(
      sourceId,
      invalidSubmissions.has(row.submission_id)
        ? null
        : {
            attribution,
            form: definitionsBySubmission.get(row.submission_id) ?? null,
            answers: answersBySubmission.get(row.submission_id) ?? {},
          },
    );
  }

  if (legacy.some((input) => !resolved.has(input.sourceId))) {
    const legacyForm = await getActiveFormForEvent(db, inputs[0]!.event, purposeFor(source));
    for (const input of legacy) {
      if (!resolved.has(input.sourceId)) {
        resolved.set(input.sourceId, {
          attribution: "legacy",
          form: legacyForm,
          answers: parseAnswers(input.answersJson),
        });
      }
    }
  }
  return resolved;
}

/** Resolves one response while retaining the same no-fallback safety policy. */
export async function resolveEventFormResponse(
  db: DatabaseLike,
  input: EventFormResponseInput,
): Promise<EventFormResponse | null> {
  return (await resolveEventFormResponses(db, [input])).get(input.sourceId) ?? null;
}
