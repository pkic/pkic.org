/**
 * GET /api/v1/admin/forms/:formKey/submissions
 *
 * Returns all submissions for a form including all answers and submitter info.
 * Supports ?status=submitted|draft|withdrawn and ?limit=N&offset=N.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { all, first } from "../../../../../_lib/db/queries";
import { parseJsonSafe } from "../../../../../_lib/utils/json";
import { AppError } from "../../../../../_lib/errors";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

interface FormRow {
  id: string;
  key: string;
  title: string;
  purpose: string;
  scope_type: string;
  scope_ref: string | null;
}
interface SubmissionRow {
  id: string;
  form_id: string;
  submitted_by_user_id: string | null;
  context_type: string | null;
  context_ref: string | null;
  status: string;
  submitted_at: string;
  user_email: string | null;
  user_first_name: string | null;
  user_last_name: string | null;
  user_organization: string | null;
}
interface AnswerRow {
  submission_id: string;
  field_key: string;
  data_json: string | null;
}

interface FieldRow {
  id: string;
  key: string;
  label: string;
  field_type: string;
  options_json: string | null;
  validation_json: string | null;
}

interface LinkedRegistrationRow {
  id: string;
  user_id: string;
  status: string;
  attendance_type: string | null;
  created_at: string;
  custom_answers_json: string | null;
  user_email: string | null;
  user_first_name: string | null;
  user_last_name: string | null;
  user_organization: string | null;
}

interface LinkedProposalRow {
  id: string;
  proposer_user_id: string;
  status: string;
  submitted_at: string;
  details_json: string | null;
  user_email: string | null;
  user_first_name: string | null;
  user_last_name: string | null;
  user_organization: string | null;
}

interface AdminSubmissionPayload {
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

interface FieldStatPayload {
  fieldKey: string;
  totalAnswers: number;
  uniqueAnswers: number;
  entries: Array<{ label: string; count: number; percent: number; weight: number }>;
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

function formatAnswerValue(value: unknown, field: FieldRow): string[] {
  const labels = optionLabelMap(parseJsonSafe(field.options_json, null));

  if (Array.isArray(value)) {
    if (value.length === 0) return ["-"];
    return value.map((entry) => (typeof entry === "string" ? (labels.get(entry) ?? entry) : stringifyAnswer(entry)));
  }

  if (typeof value === "string") return [labels.get(value) ?? stringifyAnswer(value)];
  return [stringifyAnswer(value)];
}

function extractStatValues(value: unknown, field: FieldRow): string[] {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return formatAnswerValue(value, field).filter((entry) => entry !== "-");
  if (typeof value === "string" && field.field_type === "textarea") {
    return value
      .split(/[,;\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return formatAnswerValue(value, field).filter((entry) => entry !== "-");
}

function buildStats(fields: FieldRow[], submissions: AdminSubmissionPayload[]): FieldStatPayload[] {
  return fields
    .map((field) => {
      const counts = new Map<string, number>();
      let totalAnswers = 0;

      for (const submission of submissions) {
        const values = extractStatValues(submission.answers[field.key], field);
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

function submitterFromRow(row: {
  user_id?: string | null;
  proposer_user_id?: string | null;
  user_email: string | null;
  user_first_name: string | null;
  user_last_name: string | null;
  user_organization: string | null;
}): AdminSubmissionPayload["submitter"] {
  const id = row.user_id ?? row.proposer_user_id ?? null;
  if (!id) return null;
  return {
    id,
    email: row.user_email,
    firstName: row.user_first_name,
    lastName: row.user_last_name,
    organization: row.user_organization,
  };
}

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const formKey = c.req.param("formKey");

  const form = await first<FormRow>(
    requestDb(c),
    "SELECT id, key, title, purpose, scope_type, scope_ref FROM forms WHERE key = ?",
    [formKey],
  );
  if (!form) throw new AppError(404, "FORM_NOT_FOUND", `Form '${formKey}' not found`);

  const url = new URL(c.req.raw.url);
  const statusFilter = url.searchParams.get("status") ?? "";
  const attendanceTypeFilter = url.searchParams.get("attendanceType") ?? "";
  const parsedLimit = parseInt(url.searchParams.get("limit") ?? "200", 10);
  const limit = Math.min(500, Math.max(0, Number.isFinite(parsedLimit) ? parsedLimit : 200));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);

  let eventId: string | null = form.scope_type === "event" ? form.scope_ref : null;
  const eventSlug = url.searchParams.get("eventSlug");
  if (eventSlug) {
    const event = await getEventBySlug(requestDb(c), eventSlug);
    eventId = event.id;
  }

  const fields = await all<FieldRow>(
    requestDb(c),
    `SELECT id, key, label, field_type, options_json, validation_json
     FROM form_fields
     WHERE form_id = ?
     ORDER BY sort_order ASC, key ASC`,
    [form.id],
  );

  const whereStatus = statusFilter ? "AND fs.status = ?" : "";
  const joinAttendance = attendanceTypeFilter && form.purpose === "event_registration";
  const whereAttendance = joinAttendance ? "AND r_filter.attendance_type = ?" : "";
  const params: unknown[] = [form.id];
  if (statusFilter) params.push(statusFilter);
  if (joinAttendance) params.push(attendanceTypeFilter);

  const submissions = await all<SubmissionRow>(
    requestDb(c),
    `SELECT
       fs.id, fs.form_id, fs.submitted_by_user_id, fs.context_type, fs.context_ref,
       fs.status, fs.submitted_at,
       u.email AS user_email, u.first_name AS user_first_name, u.last_name AS user_last_name,
       u.organization_name AS user_organization
     FROM form_submissions fs
     LEFT JOIN users u ON u.id = fs.submitted_by_user_id
     ${joinAttendance ? "LEFT JOIN registrations r_filter ON r_filter.id = fs.context_ref AND fs.context_type = 'registration'" : ""}
     WHERE fs.form_id = ? ${whereStatus} ${whereAttendance}
     ORDER BY fs.submitted_at DESC`,
    params,
  );

  const enriched: AdminSubmissionPayload[] = [];

  // Batch-load all answers for these submissions
  const submissionIds = submissions.map((s) => s.id);
  const answers = submissionIds.length
    ? await all<AnswerRow>(
        requestDb(c),
        `SELECT submission_id, field_key, data_json
         FROM form_submission_answers
         WHERE submission_id IN (${submissionIds.map(() => "?").join(",")})
         ORDER BY submission_id, field_key`,
        submissionIds,
      )
    : [];

  // Group answers by submission_id
  const answersBySubmission = new Map<string, Record<string, unknown>>();
  for (const answer of answers) {
    const existing = answersBySubmission.get(answer.submission_id) ?? {};
    existing[answer.field_key] = parseJsonSafe(answer.data_json, null);
    answersBySubmission.set(answer.submission_id, existing);
  }

  const seenContextRefs = new Set<string>();
  for (const s of submissions) {
    if (s.context_type && s.context_ref) seenContextRefs.add(`${s.context_type}:${s.context_ref}`);
    enriched.push({
      id: s.id,
      status: s.status,
      submittedAt: s.submitted_at,
      contextType: s.context_type,
      contextRef: s.context_ref,
      submitter: submitterFromRow({
        user_id: s.submitted_by_user_id,
        user_email: s.user_email,
        user_first_name: s.user_first_name,
        user_last_name: s.user_last_name,
        user_organization: s.user_organization,
      }),
      answers: answersBySubmission.get(s.id) ?? {},
    });
  }

  if (eventId && form.purpose === "event_registration") {
    const whereLinkedStatus = statusFilter ? "AND r.status = ?" : "";
    const whereLinkedAttendance = attendanceTypeFilter ? "AND r.attendance_type = ?" : "";
    const linkedParams: unknown[] = [eventId];
    if (statusFilter) linkedParams.push(statusFilter);
    if (attendanceTypeFilter) linkedParams.push(attendanceTypeFilter);

    const linked = await all<LinkedRegistrationRow>(
      requestDb(c),
      `SELECT r.id, r.user_id, r.status, r.attendance_type, r.created_at, r.custom_answers_json,
              u.email AS user_email, u.first_name AS user_first_name, u.last_name AS user_last_name,
              u.organization_name AS user_organization
       FROM registrations r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.event_id = ? AND r.custom_answers_json IS NOT NULL ${whereLinkedStatus} ${whereLinkedAttendance}
       ORDER BY r.created_at DESC`,
      linkedParams,
    );

    for (const row of linked) {
      if (seenContextRefs.has(`registration:${row.id}`)) continue;
      enriched.push({
        id: `registration:${row.id}`,
        status: row.status,
        submittedAt: row.created_at,
        contextType: "registration",
        contextRef: row.id,
        submitter: submitterFromRow(row),
        answers: parseJsonSafe<Record<string, unknown>>(row.custom_answers_json, {}),
      });
    }
  }

  if (eventId && form.purpose === "proposal_submission") {
    const whereLinkedStatus = statusFilter ? "AND sp.status = ?" : "";
    const linkedParams: unknown[] = [eventId];
    if (statusFilter) linkedParams.push(statusFilter);

    const linked = await all<LinkedProposalRow>(
      requestDb(c),
      `SELECT sp.id, sp.proposer_user_id, sp.status, sp.submitted_at, sp.details_json,
              u.email AS user_email, u.first_name AS user_first_name, u.last_name AS user_last_name,
              u.organization_name AS user_organization
       FROM session_proposals sp
       LEFT JOIN users u ON u.id = sp.proposer_user_id
       WHERE sp.event_id = ? AND sp.details_json IS NOT NULL ${whereLinkedStatus}
       ORDER BY sp.submitted_at DESC`,
      linkedParams,
    );

    for (const row of linked) {
      if (seenContextRefs.has(`proposal:${row.id}`)) continue;
      enriched.push({
        id: `proposal:${row.id}`,
        status: row.status,
        submittedAt: row.submitted_at,
        contextType: "proposal",
        contextRef: row.id,
        submitter: submitterFromRow(row),
        answers: parseJsonSafe<Record<string, unknown>>(row.details_json, {}),
      });
    }
  }

  const sorted = enriched.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const paged = sorted.slice(offset, offset + limit);

  return json({
    form: { id: form.id, key: form.key, title: form.title, purpose: form.purpose },
    total: sorted.length,
    offset,
    limit,
    page: { total: sorted.length, hasMore: offset + limit < sorted.length },
    stats: buildStats(fields, sorted),
    submissions: paged,
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method === "GET") return onRequestGet(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
