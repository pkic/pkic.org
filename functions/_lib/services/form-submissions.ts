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
 * The per-field answer statistics (`stats`, requested via `limit=0`) are the
 * one part of this endpoint that is NOT fully bounded: an accurate
 * distribution requires scanning every matching submission's answers, and
 * those answers are heterogeneous free-form JSON (form_submission_answers
 * rows keyed by field, vs. one JSON blob column on registrations/proposals)
 * — turning that into a single bounded SQL aggregation would need a schema
 * change (e.g. a normalized answers table for registrations/proposals too)
 * that's out of scope here. As an interim bound, `fetchStatsScanRows` caps
 * the stats scan at STATS_SCAN_ROW_LIMIT rows instead of scanning an
 * unbounded matching set, and is called out explicitly wherever it's used.
 */
import { all, first } from "../db/queries";
import { batchFirst, batchRows, queryPage } from "../db/pagination";
import { resolveOrderBy } from "../db/sort";
import { parseJsonSafe } from "../utils/json";
import { AppError } from "../errors";
import { getEventBySlug } from "./events";
import { FORM_SUBMISSIONS_SORT_COLUMNS } from "../../../assets/shared/schemas/api";
import type { DatabaseLike } from "../types";

/** Interim bound on how many matching rows the `limit=0` stats scan reads — see file header. */
const STATS_SCAN_ROW_LIMIT = 5000;

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
  stats: FieldStatPayload[];
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

function stringifyAnswer(value: unknown): string {
  if (typeof value === "string") return value.trim().length > 0 ? value : "-";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value == null) return "-";
  return JSON.stringify(value, null, 2);
}

function formatAnswerValue(value: unknown, labels: Map<string, string>): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return ["-"];
    return value.map((entry) => (typeof entry === "string" ? (labels.get(entry) ?? entry) : stringifyAnswer(entry)));
  }

  if (typeof value === "string") return [labels.get(value) ?? stringifyAnswer(value)];
  return [stringifyAnswer(value)];
}

function extractStatValues(value: unknown, field: FieldRow, labels: Map<string, string>): string[] {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return formatAnswerValue(value, labels).filter((entry) => entry !== "-");
  if (typeof value === "string" && field.field_type === "textarea") {
    return value
      .split(/[,;\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return formatAnswerValue(value, labels).filter((entry) => entry !== "-");
}

function buildFieldStatContexts(fields: FieldRow[]): FieldStatContext[] {
  return fields.map((field) => ({
    field,
    labels: optionLabelMap(parseJsonSafe(field.options_json, null)),
  }));
}

function buildStats(fieldContexts: FieldStatContext[], submissions: AdminSubmissionPayload[]): FieldStatPayload[] {
  return fieldContexts
    .map(({ field, labels }) => {
      const counts = new Map<string, number>();
      let totalAnswers = 0;

      for (const submission of submissions) {
        const values = extractStatValues(submission.answers[field.key], field, labels);
        if (values.length === 0) continue;
        totalAnswers += 1;
        for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
      }

      const maxCount = Math.max(1, ...counts.values());
      const countedValues = Array.from(counts.values()).reduce((sum, count) => sum + count, 0) || 1;
      const entries = Array.from(counts.entries())
        .map(([label, count]) => ({
          label,
          count,
          percent: Math.round((count / countedValues) * 100),
          weight: count / maxCount,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

      return { fieldKey: field.key, totalAnswers, uniqueAnswers: entries.length, entries };
    })
    .filter((stat) => stat.entries.length > 0);
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
  purpose: string;
  eventId: string | null;
}): { cte: string; args: unknown[] } {
  const { formId, statusFilter, attendanceTypeFilter, purpose, eventId } = params;
  const args: unknown[] = [];

  const joinAttendance = Boolean(attendanceTypeFilter) && purpose === "event_registration";
  const submitterExpr = submitterSortSql("u.first_name", "u.last_name", "u.email");

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
     ${joinAttendance ? "AND r_filter.attendance_type = ?" : ""}`,
  ];
  args.push(formId);
  if (statusFilter) args.push(statusFilter);
  if (joinAttendance) args.push(attendanceTypeFilter);

  if (eventId && purpose === "event_registration") {
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
         AND NOT EXISTS (
           SELECT 1 FROM form_submissions fs2
           WHERE fs2.form_id = ? AND fs2.context_type = 'registration' AND fs2.context_ref = r.id
         )`,
    );
    args.push(eventId);
    if (statusFilter) args.push(statusFilter);
    if (attendanceTypeFilter) args.push(attendanceTypeFilter);
    args.push(formId);
  }

  if (eventId && purpose === "proposal_submission") {
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
         AND NOT EXISTS (
           SELECT 1 FROM form_submissions fs2
           WHERE fs2.form_id = ? AND fs2.context_type = 'proposal' AND fs2.context_ref = sp.id
         )`,
    );
    args.push(eventId);
    if (statusFilter) args.push(statusFilter);
    args.push(formId);
  }

  return { cte: `WITH merged AS (${branches.join(" UNION ALL ")})`, args };
}

// Batch-loads form_submission_answers for exactly the `source: 'submission'`
// rows present in `rows` (bounded to however many rows the caller already
// read — a page, or the capped stats scan — never the full dataset) and
// attaches parsed `answers` to every row, submission-sourced or not.
async function attachAnswers(db: DatabaseLike, rows: MergedSubmissionRow[]): Promise<AdminSubmissionPayload[]> {
  const submissionIds = rows.filter((row) => row.source === "submission").map((row) => row.source_id);

  const answerRows = submissionIds.length
    ? await all<AnswerRow>(
        db,
        `SELECT submission_id, field_key, data_json
         FROM form_submission_answers
         WHERE submission_id IN (${submissionIds.map(() => "?").join(",")})
         ORDER BY submission_id, field_key`,
        submissionIds,
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
  const form = await getFormByKey(db, params.formKey);

  let eventId: string | null = form.scope_type === "event" ? form.scope_ref : null;
  if (params.eventSlug) {
    const event = await getEventBySlug(db, params.eventSlug);
    eventId = event.id;
  }

  const fields = await all<FieldRow>(
    db,
    `SELECT id, key, label, field_type, options_json, validation_json
     FROM form_fields
     WHERE form_id = ?
     ORDER BY sort_order ASC, key ASC`,
    [form.id],
  );
  const fieldContexts = buildFieldStatContexts(fields);

  const { cte, args } = buildMergedSubmissionsQuery({
    formId: form.id,
    statusFilter: params.status,
    attendanceTypeFilter: params.attendanceType,
    purpose: form.purpose,
    eventId,
  });
  const orderBy = resolveOrderBy(params.sort, FORM_SUBMISSIONS_SORT_COLUMNS, "ORDER BY submitted_at DESC");

  let pageRows: MergedSubmissionRow[] = [];
  let statsRows: MergedSubmissionRow[] = [];
  let total: number;

  if (params.limit > 0) {
    const page = await queryPage<MergedSubmissionRow>(
      db,
      {
        sql: `${cte} SELECT * FROM merged ${orderBy} LIMIT ? OFFSET ?`,
        bindings: [...args, params.limit, params.offset],
      },
      { sql: `${cte} SELECT COUNT(*) AS total FROM merged`, bindings: args },
    );
    pageRows = page.rows;
    total = page.total;
  } else {
    const [countResult, statsResult] = await db.batch([
      db.prepare(`${cte} SELECT COUNT(*) AS total FROM merged`).bind(...args),
      // See file header — bounded stand-in for a true full-population scan.
      db.prepare(`${cte} SELECT * FROM merged ${orderBy} LIMIT ?`).bind(...args, STATS_SCAN_ROW_LIMIT),
    ]);
    total = Number(batchFirst<{ total: number }>(countResult)?.total ?? 0);
    statsRows = batchRows<MergedSubmissionRow>(statsResult);
  }

  const submissions = pageRows.length > 0 ? await attachAnswers(db, pageRows) : [];
  const statsSubmissions = statsRows.length > 0 ? await attachAnswers(db, statsRows) : [];

  return {
    form: { id: form.id, key: form.key, title: form.title, purpose: form.purpose },
    total,
    offset: params.offset,
    limit: params.limit,
    submissions,
    stats: params.limit === 0 ? buildStats(fieldContexts, statsSubmissions) : [],
  };
}
