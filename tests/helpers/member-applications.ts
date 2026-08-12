import { env } from "cloudflare:workers";
import { queryAll } from "./context";

/**
 * member_applications no longer carries its own answers_json blob (PR review
 * fix — see functions/_lib/services/member-applications.ts's
 * getApplicationAnswers); answers live in form_submissions/
 * form_submission_answers via the 'membership-application' global form
 * seeded by migrations/0034. resetDb() wipes forms/form_fields like every
 * other non-system table, so tests that need a real application answer must
 * re-seed the form themselves, the same convention tests already use for
 * working_groups (see reset-db.ts's EXCLUDED_TABLES comment).
 */

const APPLICATION_FORM_KEY = "membership-application";

export async function seedMembershipApplicationForm(): Promise<string> {
  const existing = await queryAll<{ id: string }>(
    env.DB,
    "SELECT id FROM forms WHERE key = ?",
    APPLICATION_FORM_KEY,
  );
  if (existing.length > 0) return existing[0].id;

  const formId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO forms (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
     VALUES (?, ?, 'global', NULL, 'application', 'active', 'PKI Consortium Membership Application', NULL, datetime('now'), datetime('now'))`,
  )
    .bind(formId, APPLICATION_FORM_KEY)
    .run();
  return formId;
}

/**
 * Creates a form_submissions row (+ one form_submission_answers row per key)
 * for the membership-application form and returns its id — bind the result
 * to member_applications.form_submission_id.
 */
export async function createApplicationFormSubmission(
  answers: Record<string, unknown>,
  options: { submittedAt?: string } = {},
): Promise<string> {
  const formId = await seedMembershipApplicationForm();
  const submissionId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO form_submissions (id, form_id, submitted_by_user_id, context_type, context_ref, status, submitted_at)
     VALUES (?, ?, NULL, 'membership', NULL, 'submitted', ?)`,
  )
    .bind(submissionId, formId, options.submittedAt ?? new Date().toISOString())
    .run();

  for (const [key, value] of Object.entries(answers)) {
    await env.DB.prepare(
      `INSERT INTO form_submission_answers (id, submission_id, field_key, data_json, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), submissionId, key, JSON.stringify(value ?? null))
      .run();
  }

  return submissionId;
}
