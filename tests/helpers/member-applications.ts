import { env } from "cloudflare:workers";
import { queryAll } from "./context";

/**
 * member_applications no longer carries its own answers_json blob (PR review
 * fix — see functions/_lib/services/membership/applications/queries.ts's
 * getApplicationAnswers); answers live in form_submissions/
 * form_submission_answers via the 'membership-application' global form
 * seeded by migrations/0034. resetDb() wipes forms/form_fields like every
 * other non-system table, so tests that need a real application answer must
 * re-seed the form themselves, the same convention tests already use for
 * working_groups (see reset-db.ts's EXCLUDED_TABLES comment).
 */

const APPLICATION_FORM_KEY = "membership-application";

export interface SeedMemberApplicationOptions {
  id?: string;
  applicantEmail?: string;
  applicantName?: string;
  organizationName?: string | null;
  organizationDomain?: string | null;
  membershipCategory?: string;
  formSubmissionId?: string | null;
  stage?: string;
  stageEnteredAt?: string;
  createdAt?: string;
  manageTokenHash?: string;
}

/**
 * Canonical test fixture for the application aggregate. Active organization
 * applications receive the same domain claim production submission creates,
 * so approval and duplicate-domain tests exercise the real invariant.
 */
export async function seedMemberApplication(options: SeedMemberApplicationOptions = {}): Promise<string> {
  const id = options.id ?? crypto.randomUUID();
  const applicantEmail = options.applicantEmail ?? "applicant@example.test";
  const organizationDomain =
    options.organizationDomain === undefined ? (applicantEmail.split("@")[1] ?? null) : options.organizationDomain;
  const stage = options.stage ?? "pending";
  const stageEnteredAt = options.stageEnteredAt ?? new Date().toISOString();
  const createdAt = options.createdAt ?? new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO member_applications
       (id, applicant_email, applicant_name, organization_name, organization_domain,
        membership_category, form_submission_id, stage, stage_entered_at,
        manage_token_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      applicantEmail,
      options.applicantName ?? "Applicant Name",
      options.organizationName === undefined ? "Example Org" : options.organizationName,
      organizationDomain,
      options.membershipCategory ?? "F",
      options.formSubmissionId ?? null,
      stage,
      stageEnteredAt,
      options.manageTokenHash ?? crypto.randomUUID(),
      createdAt,
      createdAt,
    )
    .run();

  if (organizationDomain && !["approved", "declined", "withdrawn"].includes(stage)) {
    await env.DB.prepare(
      `INSERT INTO organization_domain_claims
         (id, domain, application_id, organization_id, created_at, updated_at)
       VALUES (?, ?, ?, NULL, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), organizationDomain, id)
      .run();
  }

  return id;
}

export async function seedMembershipApplicationForm(): Promise<string> {
  const existing = await queryAll<{ id: string }>(env.DB, "SELECT id FROM forms WHERE key = ?", APPLICATION_FORM_KEY);
  if (existing.length > 0) return existing[0].id;

  const formId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO forms (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
     VALUES (?, ?, 'global', NULL, 'application', 'active', 'PKI Consortium Membership Application', NULL, datetime('now'), datetime('now'))`,
  )
    .bind(formId, APPLICATION_FORM_KEY)
    .run();
  const fields = [
    ["job_title", "Role / Job Title", "text", 0, null],
    ["linkedin", "LinkedIn Profile", "url", 0, null],
    ["organization_website", "Organization Website", "url", 0, null],
    ["about_yourself", "About Yourself", "textarea", 0, null],
    ["about_organization", "About Your Organization", "textarea", 0, null],
    ["reason", "Why do you want to join PKI Consortium?", "textarea", 1, null],
    [
      "working_groups",
      "Working Groups of Interest",
      "multi_select",
      0,
      JSON.stringify(["pqc", "cm", "pkimm", "tcwg", "ca", "cbom"]),
    ],
  ] as const;
  await env.DB.batch(
    fields.map(([key, label, fieldType, required, optionsJson], index) =>
      env.DB.prepare(
        `INSERT INTO form_fields
           (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), formId, key, label, fieldType, required, optionsJson, (index + 1) * 10),
    ),
  );
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
