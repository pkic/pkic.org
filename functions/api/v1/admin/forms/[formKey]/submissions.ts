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
import type { PagesContext } from "../../../../../_lib/types";

interface FormRow { id: string; key: string; title: string; purpose: string; }
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

export async function onRequestGet(
  context: PagesContext<{ formKey: string }>,
): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);

  const form = await first<FormRow>(
    context.env.DB,
    "SELECT id, key, title, purpose FROM forms WHERE key = ?",
    [context.params.formKey],
  );
  if (!form) throw new AppError(404, "FORM_NOT_FOUND", `Form '${context.params.formKey}' not found`);

  const url = new URL(context.request.url);
  const statusFilter = url.searchParams.get("status") ?? "";
  const limit = Math.min(500, parseInt(url.searchParams.get("limit") ?? "200", 10) || 200);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);

  const whereStatus = statusFilter ? "AND fs.status = ?" : "";
  const params: unknown[] = [form.id];
  if (statusFilter) params.push(statusFilter);
  params.push(limit, offset);

  const submissions = await all<SubmissionRow>(
    context.env.DB,
    `SELECT
       fs.id, fs.form_id, fs.submitted_by_user_id, fs.context_type, fs.context_ref,
       fs.status, fs.submitted_at,
       u.email AS user_email, u.first_name AS user_first_name, u.last_name AS user_last_name,
       u.organization_name AS user_organization
     FROM form_submissions fs
     LEFT JOIN users u ON u.id = fs.submitted_by_user_id
     WHERE fs.form_id = ? ${whereStatus}
     ORDER BY fs.submitted_at DESC
     LIMIT ? OFFSET ?`,
    params,
  );

  if (!submissions.length) {
    return json({ form: { id: form.id, key: form.key, title: form.title, purpose: form.purpose }, submissions: [] });
  }

  // Batch-load all answers for these submissions
  const submissionIds = submissions.map((s) => s.id);
  const placeholders = submissionIds.map(() => "?").join(",");
  const answers = await all<AnswerRow>(
    context.env.DB,
    `SELECT submission_id, field_key, data_json
     FROM form_submission_answers
     WHERE submission_id IN (${placeholders})
     ORDER BY submission_id, field_key`,
    submissionIds,
  );

  // Group answers by submission_id
  const answersBySubmission = new Map<string, Record<string, unknown>>();
  for (const answer of answers) {
    const existing = answersBySubmission.get(answer.submission_id) ?? {};
    existing[answer.field_key] = parseJsonSafe(answer.data_json, null);
    answersBySubmission.set(answer.submission_id, existing);
  }

  const enriched = submissions.map((s) => ({
    id: s.id,
    status: s.status,
    submittedAt: s.submitted_at,
    contextType: s.context_type,
    contextRef: s.context_ref,
    submitter: s.submitted_by_user_id
      ? {
          id: s.submitted_by_user_id,
          email: s.user_email,
          firstName: s.user_first_name,
          lastName: s.user_last_name,
          organization: s.user_organization,
        }
      : null,
    answers: answersBySubmission.get(s.id) ?? {},
  }));

  return json({
    form: { id: form.id, key: form.key, title: form.title, purpose: form.purpose },
    total: enriched.length,
    offset,
    limit,
    submissions: enriched,
  });
}

export async function onRequest(
  context: PagesContext<{ formKey: string }>,
): Promise<Response> {
  if (context.request.method === "GET") return onRequestGet(context);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
