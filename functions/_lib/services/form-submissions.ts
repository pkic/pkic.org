/**
 * Read model for GET /api/v1/admin/forms/:formKey/submissions
 * (functions/api/v1/admin/forms/[formKey]/submissions.ts). Backs the admin
 * Responses/Statistics tabs (assets/ts/admin/sections/events/detail/
 * FormResponses.tsx).
 *
 * A form's "submissions" list is a merge of up to three sources:
 *  1. form_submissions rows submitted through the generic custom-form flow.
 *  2. For `purpose = 'event_registration'` forms, event registrations whose
 *     `custom_answers_json` hasn't been backfilled into form_submissions yet.
 *  3. For `purpose = 'proposal_submission'` forms, session proposals whose
 *     `details_json` hasn't been backfilled into form_submissions yet.
 * (2) and (3) are mutually exclusive per form (a form has one `purpose`), so
 * at most two sources ever contribute rows to a given request.
 *
 * P6M-P1-03: this used to fetch *all* matching rows from every source with
 * no LIMIT, sort them in memory, then slice out a page — unbounded per
 * request. `buildMergedSubmissionsQuery` below expresses the merge as a
 * single SQL `UNION ALL` (a `merged` CTE), so `listFormSubmissions` can apply
 * real `ORDER BY` + `LIMIT`/`OFFSET` + `COUNT(*)` in SQL instead of loading
 * every row into memory to paginate.
 *
 * Per-field statistics use a separate aggregate query and endpoint. JSON1
 * normalizes both stored answer shapes inside D1, so statistics are exact
 * for the full filtered population without materializing an arbitrary first
 * N submissions in the Worker.
 */
import { all, first } from "../db/queries";
import { batchFirst, batchRows, queryPage } from "../db/pagination";
import { buildD1JsonMembershipFilter } from "../db/json-membership";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveOrderBy } from "../db/sort";
import { parseJsonSafe } from "../utils/json";
import { AppError } from "../errors";
import { getEventBySlug } from "./events";
import { FORM_SUBMISSIONS_SORT_COLUMNS } from "../../../assets/shared/schemas/api";
import type { DatabaseLike } from "../types";

const MAX_STATS_ENTRIES_PER_FIELD = 50;

export interface FormRow {
  id: string;
  key: string;
  title: string;
  purpose: string;
  scope_type: string;
  scope_ref: string | null;
}

export interface FieldRow {
  id: string;
  key: string;
  label: string;
  field_type: string;
  options_json: string | null;
  validation_json: string | null;
}

interface AnswerRow {
  submission_id: string;
  field_key: string;
  data_json: string | null;
}

interface MergedSubmissionRow {
  id: string;
  source: "submission" | "registration" | "proposal";
  source_id: string;
  context_type: string | null;
  context_ref: string | null;
  status: string;
  submitted_at: string;
  user_id: string | null;
  user_email: string | null;
  user_first_name: string | null;
  user_last_name: string | null;
  user_organization: string | null;
  answers_json: string | null;
}

export interface AdminSubmissionPayload {
  id: string;
  status: string;
  submittedAt: string;
  contextType: string | null;
  contextRef: string | null;
  submitter: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    organization: string | null;
  } | null;
  answers: Record<string, unknown>;
}

export interface FieldStatPayload {
  fieldKey: string;
  totalAnswers: number;
  uniqueAnswers: number;
  entries: Array<{ label: string; count: number; percent: number; weight: number }>;
}

interface FieldStatContext {
  field: FieldRow;
  labels: Map<string, string>;
}

export interface ListFormSubmissionsParams {
  formKey: string;
  status: string;
  attendanceType: string;
  eventSlug: string;
  q?: string;
  sort?: string;
  limit: number;
  offset: number;
}

export interface ListFormSubmissionsResult {
  form: { id: string; key: string; title: string; purpose: string };
  total: number;
  offset: number;
  limit: number;
  submissions: AdminSubmissionPayload[];
}

export interface GetFormSubmissionStatsParams {
  formKey: string;
  status: string;
  attendanceType: string;
  eventSlug: string;
  q?: string;
}

export interface GetFormSubmissionStatsResult {
  form: { id: string; key: string; title: string; purpose: string };
  total: number;
  stats: FieldStatPayload[];
}

interface FormSubmissionPopulation {
  form: FormRow;
  cte: string;
  args: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionLabelMap(options: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  if (!Array.isArray(options)) return labels;

  for (const entry of options) {
    if (typeof entry === "string") {
      labels.set(entry, entry);
    } else if (isRecord(entry) && typeof entry.value === "string") {
      labels.set(
        entry.value,
        typeof entry.label === "string" && entry.label.trim().length > 0 ? entry.label.trim() : entry.value,
      );
    }
  }

  return labels;
}

function buildFieldStatContexts(fields: FieldRow[]): FieldStatContext[] {
  return fields.map((field) => ({
    field,
    labels: optionLabelMap(parseJsonSafe(field.options_json, null)),
  }));
}

interface AggregatedStatRow {
  field_key: string;
  label: string;
  count: number;
  total_answers: number;
  unique_answers: number;
}

function buildStats(fieldContexts: FieldStatContext[], rows: AggregatedStatRow[]): FieldStatPayload[] {
  const contextByKey = new Map(fieldContexts.map((context) => [context.field.key, context]));
  const rowsByField = new Map<string, AggregatedStatRow[]>();
  for (const row of rows) {
    const values = rowsByField.get(row.field_key) ?? [];
    values.push(row);
    rowsByField.set(row.field_key, values);
  }
  return Array.from(rowsByField.entries()).map(([fieldKey, fieldRows]) => {
    const context = contextByKey.get(fieldKey);
    const merged = new Map<string, number>();
    for (const row of fieldRows) {
      const label = context?.labels.get(row.label) ?? row.label;
      merged.set(label, (merged.get(label) ?? 0) + Number(row.count));
    }
    const maxCount = Math.max(1, ...merged.values());
    const countedValues = Array.from(merged.values()).reduce((sum, count) => sum + count, 0) || 1;
    const entries = Array.from(merged.entries())
      .map(([label, count]) => ({
        label,
        count,
        percent: Math.round((count / countedValues) * 100),
        weight: count / maxCount,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return {
      fieldKey,
      totalAnswers: Number(fieldRows[0]?.total_answers ?? 0),
      uniqueAnswers: Number(fieldRows[0]?.unique_answers ?? entries.length),
      entries,
    };
  });
}

// Ascending-sort submitter display-name/email key, computed identically in
// SQL (see submitterSortSql below) so `ORDER BY submitter` in the `merged`
// CTE matches this JS shape for any row loaded back out of it.
function submitterSortSql(firstName: string, lastName: string, email: string): string {
  return `LOWER(COALESCE(NULLIF(TRIM(COALESCE(${firstName},'') || ' ' || COALESCE(${lastName},'')), ''), ${email}, ''))`;
}

function submitterFromRow(row: {
  user_id: string | null;
  user_email: string | null;
  user_first_name: string | null;
  user_last_name: string | null;
  user_organization: string | null;
}): AdminSubmissionPayload["submitter"] {
  if (!row.user_id) return null;
  return {
    id: row.user_id,
    email: row.user_email,
    firstName: row.user_first_name,
    lastName: row.user_last_name,
    organization: row.user_organization,
  };
}

/**
 * Builds the `merged` CTE (see file header) plus its bound parameters. The
 * form_submissions branch always contributes; the registrations/proposals
 * branch is appended only when it can actually apply (event-scoped form of
 * the matching purpose) — so this is a UNION of at most two branches, not a
 * fixed three, even though up to three source tables are named in the
 * finding this fixes.
 *
 * All three branches share one 14-column shape so `UNION ALL` lines up:
 * (id, source, source_id, context_type, context_ref, status, submitted_at,
 * user_id, user_email, user_first_name, user_last_name, user_organization,
 * answers_json, submitter). `answers_json` is populated directly for the
 * registrations/proposals branches (a single JSON blob column already), and
 * left NULL for the form_submissions branch — its per-field answers live in
 * a separate table and are batch-loaded afterward, bounded to just the ids
 * present in whatever bounded row set was read back out of `merged` (see
 * `attachAnswers`), the same batching shape the rest of the codebase already
 * uses for "answers for these N rows" lookups.
 */
function buildMergedSubmissionsQuery(params: {
  formId: string;
  statusFilter: string;
  attendanceTypeFilter: string;
  searchQuery?: string;
  purpose: string;
  eventId: string | null;
}): { cte: string; args: unknown[] } {
  const { formId, statusFilter, attendanceTypeFilter, searchQuery, purpose, eventId } = params;
  const args: unknown[] = [];

  function searchClause(expressions: readonly string[]): { sql: string; bindings: string[] } {
    if (!searchQuery) return { sql: "", bindings: [] };
    const search = buildD1TextSearchFilter(searchQuery, expressions);
    return { sql: `AND ${search.sql}`, bindings: search.bindings };
  }

  const joinAttendance = Boolean(attendanceTypeFilter) && purpose === "event_registration";
  const submitterExpr = submitterSortSql("u.first_name", "u.last_name", "u.email");
  const submissionSearch = searchClause(["u.email", "u.first_name", "u.last_name", "u.organization_name", "fs.status"]);

  const branches: string[] = [
    `SELECT
       fs.id AS id,
       'submission' AS source,
       fs.id AS source_id,
       fs.context_type AS context_type,
       fs.context_ref AS context_ref,
       fs.status AS status,
       fs.submitted_at AS submitted_at,
       fs.submitted_by_user_id AS user_id,
       u.email AS user_email,
       u.first_name AS user_first_name,
       u.last_name AS user_last_name,
       u.organization_name AS user_organization,
       NULL AS answers_json,
       ${submitterExpr} AS submitter
     FROM form_submissions fs
     LEFT JOIN users u ON u.id = fs.submitted_by_user_id
     ${joinAttendance ? "LEFT JOIN registrations r_filter ON r_filter.id = fs.context_ref AND fs.context_type = 'registration'" : ""}
     WHERE fs.form_id = ?
     ${statusFilter ? "AND fs.status = ?" : ""}
     ${joinAttendance ? "AND r_filter.attendance_type = ?" : ""}
     ${submissionSearch.sql}`,
  ];
  args.push(formId);
  if (statusFilter) args.push(statusFilter);
  if (joinAttendance) args.push(attendanceTypeFilter);
  args.push(...submissionSearch.bindings);

  if (eventId && purpose === "event_registration") {
    const registrationSearch = searchClause([
      "u.email",
      "u.first_name",
      "u.last_name",
      "u.organization_name",
      "r.status",
    ]);
    branches.push(
      `SELECT
         'registration:' || r.id AS id,
         'registration' AS source,
         r.id AS source_id,
         'registration' AS context_type,
         r.id AS context_ref,
         r.status AS status,
         r.created_at AS submitted_at,
         r.user_id AS user_id,
         u.email AS user_email,
         u.first_name AS user_first_name,
         u.last_name AS user_last_name,
         u.organization_name AS user_organization,
         r.custom_answers_json AS answers_json,
         ${submitterExpr} AS submitter
       FROM registrations r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.event_id = ?
         AND r.custom_answers_json IS NOT NULL
         ${statusFilter ? "AND r.status = ?" : ""}
         ${attendanceTypeFilter ? "AND r.attendance_type = ?" : ""}
         ${registrationSearch.sql}
         AND NOT EXISTS (
           SELECT 1 FROM form_submissions fs2
           WHERE fs2.form_id = ? AND fs2.context_type = 'registration' AND fs2.context_ref = r.id
         )`,
    );
    args.push(eventId);
    if (statusFilter) args.push(statusFilter);
    if (attendanceTypeFilter) args.push(attendanceTypeFilter);
    args.push(...registrationSearch.bindings);
    args.push(formId);
  }

  if (eventId && purpose === "proposal_submission") {
    const proposalSearch = searchClause([
      "u.email",
      "u.first_name",
      "u.last_name",
      "u.organization_name",
      "sp.status",
      "sp.title",
    ]);
    branches.push(
      `SELECT
         'proposal:' || sp.id AS id,
         'proposal' AS source,
         sp.id AS source_id,
         'proposal' AS context_type,
         sp.id AS context_ref,
         sp.status AS status,
         sp.submitted_at AS submitted_at,
         sp.proposer_user_id AS user_id,
         u.email AS user_email,
         u.first_name AS user_first_name,
         u.last_name AS user_last_name,
         u.organization_name AS user_organization,
         sp.details_json AS answers_json,
         ${submitterExpr} AS submitter
       FROM session_proposals sp
       LEFT JOIN users u ON u.id = sp.proposer_user_id
       WHERE sp.event_id = ?
         AND sp.details_json IS NOT NULL
         ${statusFilter ? "AND sp.status = ?" : ""}
         ${proposalSearch.sql}
         AND NOT EXISTS (
           SELECT 1 FROM form_submissions fs2
           WHERE fs2.form_id = ? AND fs2.context_type = 'proposal' AND fs2.context_ref = sp.id
         )`,
    );
    args.push(eventId);
    if (statusFilter) args.push(statusFilter);
    args.push(...proposalSearch.bindings);
    args.push(formId);
  }

  return { cte: `WITH merged AS (${branches.join(" UNION ALL ")})`, args };
}

async function resolveFormSubmissionPopulation(
  db: DatabaseLike,
  params: Pick<ListFormSubmissionsParams, "formKey" | "status" | "attendanceType" | "eventSlug" | "q">,
): Promise<FormSubmissionPopulation> {
  const form = await getFormByKey(db, params.formKey);
  const eventId = params.eventSlug
    ? (await getEventBySlug(db, params.eventSlug)).id
    : form.scope_type === "event"
      ? form.scope_ref
      : null;
  const query = buildMergedSubmissionsQuery({
    formId: form.id,
    statusFilter: params.status,
    attendanceTypeFilter: params.attendanceType,
    searchQuery: params.q,
    purpose: form.purpose,
    eventId,
  });
  return { form, ...query };
}

// Batch-loads form_submission_answers for exactly the `source: 'submission'`
// rows present in `rows` (bounded to however many rows the caller already
// read — a page, or the capped stats scan — never the full dataset) and
// attaches parsed `answers` to every row, submission-sourced or not.
async function attachAnswers(db: DatabaseLike, rows: MergedSubmissionRow[]): Promise<AdminSubmissionPayload[]> {
  const submissionIds = rows.filter((row) => row.source === "submission").map((row) => row.source_id);
  const submissionFilter = buildD1JsonMembershipFilter("submission_id", submissionIds);

  const answerRows = submissionIds.length
    ? await all<AnswerRow>(
        db,
        `SELECT submission_id, field_key, data_json
         FROM form_submission_answers
         WHERE ${submissionFilter.sql}
         ORDER BY submission_id, field_key`,
        submissionFilter.bindings,
      )
    : [];

  const answersBySubmission = new Map<string, Record<string, unknown>>();
  for (const answer of answerRows) {
    const existing = answersBySubmission.get(answer.submission_id) ?? {};
    existing[answer.field_key] = parseJsonSafe(answer.data_json, null);
    answersBySubmission.set(answer.submission_id, existing);
  }

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    submittedAt: row.submitted_at,
    contextType: row.context_type,
    contextRef: row.context_ref,
    submitter: submitterFromRow(row),
    answers:
      row.source === "submission"
        ? (answersBySubmission.get(row.source_id) ?? {})
        : parseJsonSafe<Record<string, unknown>>(row.answers_json, {}),
  }));
}

export async function getFormByKey(db: DatabaseLike, formKey: string): Promise<FormRow> {
  const form = await first<FormRow>(
    db,
    "SELECT id, key, title, purpose, scope_type, scope_ref FROM forms WHERE key = ?",
    [formKey],
  );
  if (!form) throw new AppError(404, "FORM_NOT_FOUND", `Form '${formKey}' not found`);
  return form;
}

export async function listFormSubmissions(
  db: DatabaseLike,
  params: ListFormSubmissionsParams,
): Promise<ListFormSubmissionsResult> {
  const { form, cte, args } = await resolveFormSubmissionPopulation(db, params);
  const orderBy = resolveOrderBy(
    params.sort,
    FORM_SUBMISSIONS_SORT_COLUMNS,
    "ORDER BY submitted_at DESC",
    "source ASC, source_id ASC",
  );

  const page = await queryPage<MergedSubmissionRow>(
    db,
    {
      sql: `${cte} SELECT * FROM merged ${orderBy} LIMIT ? OFFSET ?`,
      bindings: [...args, params.limit, params.offset],
    },
    { sql: `${cte} SELECT COUNT(*) AS total FROM merged`, bindings: args },
  );
  const submissions = page.rows.length > 0 ? await attachAnswers(db, page.rows) : [];

  return {
    form: { id: form.id, key: form.key, title: form.title, purpose: form.purpose },
    total: page.total,
    offset: params.offset,
    limit: params.limit,
    submissions,
  };
}

export async function getFormSubmissionStats(
  db: DatabaseLike,
  params: GetFormSubmissionStatsParams,
): Promise<GetFormSubmissionStatsResult> {
  const { form, cte, args } = await resolveFormSubmissionPopulation(db, params);
  const fields = await all<FieldRow>(
    db,
    `SELECT id, key, label, field_type, options_json, validation_json
     FROM form_fields
     WHERE form_id = ?
     ORDER BY sort_order ASC, key ASC`,
    [form.id],
  );
  const aggregateSql = `${cte},
    normalized_answers AS (
      SELECT m.id AS submission_id, a.field_key, a.data_json
      FROM merged m
      JOIN form_submission_answers a ON m.source = 'submission' AND a.submission_id = m.source_id
      UNION ALL
      SELECT m.id AS submission_id, je.key AS field_key,
             CASE WHEN je.type IN ('array', 'object') THEN json(je.value) ELSE json_quote(je.value) END AS data_json
      FROM merged m
      CROSS JOIN json_each(COALESCE(m.answers_json, '{}')) je
      WHERE m.source IN ('registration', 'proposal')
    ),
    expanded_raw AS (
      SELECT a.submission_id, a.field_key, value.type AS value_type, value.value AS value
      FROM normalized_answers a
      CROSS JOIN json_each(
        CASE
          WHEN json_valid(a.data_json) AND json_type(a.data_json) = 'array' THEN a.data_json
          WHEN json_valid(a.data_json) THEN json_array(json_extract(a.data_json, '$'))
          ELSE json_array(a.data_json)
        END
      ) value
    ),
    labeled AS (
      SELECT submission_id, field_key,
             CASE value_type
               WHEN 'true' THEN 'Yes'
               WHEN 'false' THEN 'No'
               WHEN 'null' THEN NULL
               WHEN 'array' THEN json(value)
               WHEN 'object' THEN json(value)
               ELSE TRIM(CAST(value AS TEXT))
             END AS label
      FROM expanded_raw
    ),
    entry_counts AS (
      SELECT field_key, label, COUNT(DISTINCT submission_id) AS count
      FROM labeled
      WHERE label IS NOT NULL AND label <> ''
      GROUP BY field_key, label
    ),
    field_totals AS (
      SELECT field_key, COUNT(DISTINCT submission_id) AS total_answers
      FROM labeled
      WHERE label IS NOT NULL AND label <> ''
      GROUP BY field_key
    ),
    ranked AS (
      SELECT e.field_key, e.label, e.count, t.total_answers,
             COUNT(*) OVER (PARTITION BY e.field_key) AS unique_answers,
             ROW_NUMBER() OVER (PARTITION BY e.field_key ORDER BY e.count DESC, e.label ASC) AS entry_rank
      FROM entry_counts e
      JOIN field_totals t ON t.field_key = e.field_key
    )
    SELECT field_key, SUBSTR(label, 1, 500) AS label, count, total_answers, unique_answers
    FROM ranked
    WHERE entry_rank <= ?
    ORDER BY field_key ASC, entry_rank ASC`;
  const [countResult, statsResult] = await db.batch([
    db.prepare(`${cte} SELECT COUNT(*) AS total FROM merged`).bind(...args),
    db.prepare(aggregateSql).bind(...args, MAX_STATS_ENTRIES_PER_FIELD),
  ]);
  return {
    form: { id: form.id, key: form.key, title: form.title, purpose: form.purpose },
    total: Number(batchFirst<{ total: number }>(countResult)?.total ?? 0),
    stats: buildStats(buildFieldStatContexts(fields), batchRows<AggregatedStatRow>(statsResult)),
  };
}
