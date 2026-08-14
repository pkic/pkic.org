import { all, first, run } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { randomToken, sha256Hex } from "../utils/crypto";
import { parseJsonSafe } from "../utils/json";
import { AppError } from "../errors";
import { getGlobalFormByKey } from "./forms";
import {
  MEMBERSHIP_CATEGORIES,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
  VOTING_CATEGORIES,
} from "../../../assets/shared/schemas/membership-categories";
import type { DatabaseLike } from "../types";

/** `forms.key` for the portal-managed membership application form (seeded in migrations/0034). */
export const MEMBERSHIP_APPLICATION_FORM_KEY = "membership-application";

export { MEMBERSHIP_CATEGORIES, INDIVIDUAL_MEMBERSHIP_CATEGORIES, VOTING_CATEGORIES };

/** Non-terminal application stages — an application in one of these still "counts" for duplicate-domain detection. */
const ACTIVE_APPLICATION_STATUSES = ["pending", "in_review", "on_hold", "in_consultation", "ec_review", "approved"];

export interface MemberApplicationRow {
  id: string;
  applicant_email: string;
  applicant_name: string;
  organization_name: string | null;
  organization_domain: string | null;
  membership_category: string;
  form_submission_id: string | null;
  status: string;
  stage: string;
  stage_entered_at: string;
  on_hold_subtype: string | null;
  review_notes: string | null;
  assigned_to_user_id: string | null;
  manage_token_hash: string;
  created_at: string;
  updated_at: string;
}

export function emailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/**
 * Returns true when an active (non-terminal) application already exists for
 * the given organization domain. Only checks member_applications, not
 * already-approved organizations — see hasConflictingOrganizationDomain for
 * that half, added once organizations gained a domain
 * column.
 */
export async function hasActiveApplicationForDomain(db: DatabaseLike, domain: string): Promise<boolean> {
  if (!domain) return false;
  const placeholders = ACTIVE_APPLICATION_STATUSES.map(() => "?").join(", ");
  const existing = await first<{ id: string }>(
    db,
    `SELECT id FROM member_applications WHERE organization_domain = ? AND status IN (${placeholders}) LIMIT 1`,
    [domain, ...ACTIVE_APPLICATION_STATUSES],
  );
  return existing !== null;
}

/**
 * Returns true when an already-approved organization's `organization_domains`
 * (populated at approval time) already lists this domain. Only for
 * organizations approved through the flow going forward; the X
 * organizations migrated have no domain data to backfill and
 * remain uncovered.
 */
export async function hasConflictingOrganizationDomain(db: DatabaseLike, domain: string): Promise<boolean> {
  if (!domain) return false;
  const existing = await first<{ id: string }>(db, `SELECT id FROM organization_domains WHERE domain = ? LIMIT 1`, [
    domain,
  ]);
  return existing !== null;
}

export interface CreateMemberApplicationInput {
  applicantEmail: string;
  applicantName: string;
  membershipCategory: string;
  organizationName?: string | null;
  answers?: Record<string, unknown>;
}

export interface CreateMemberApplicationResult {
  id: string;
  manageToken: string;
  status: string;
  stage: string;
}

export async function createMemberApplication(
  db: DatabaseLike,
  input: CreateMemberApplicationInput,
): Promise<CreateMemberApplicationResult> {
  const id = uuid();
  const now = nowIso();
  const manageToken = randomToken(24);
  const manageTokenHash = await sha256Hex(manageToken);
  const isIndividual = INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(input.membershipCategory);
  const organizationDomain = isIndividual ? null : emailDomain(input.applicantEmail);

  const hasAnswers = input.answers && Object.keys(input.answers).length > 0;
  let formSubmissionId: string | null = null;
  const statements = [];

  if (hasAnswers) {
    const form = await getGlobalFormByKey(db, MEMBERSHIP_APPLICATION_FORM_KEY);
    if (form) {
      formSubmissionId = uuid();
      statements.push(
        db
          .prepare(
            `INSERT INTO form_submissions (id, form_id, submitted_by_user_id, context_type, context_ref, status, submitted_at)
             VALUES (?, ?, NULL, 'membership', ?, 'submitted', ?)`,
          )
          .bind(formSubmissionId, form.id, id, now),
      );
      for (const [key, value] of Object.entries(input.answers as Record<string, unknown>)) {
        statements.push(
          db
            .prepare(
              `INSERT INTO form_submission_answers (id, submission_id, field_key, data_json, created_at)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .bind(uuid(), formSubmissionId, key, JSON.stringify(value ?? null), now),
        );
      }
    }
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO member_applications
           (id, applicant_email, applicant_name, organization_name, organization_domain,
            membership_category, form_submission_id, status, stage, stage_entered_at,
            manage_token_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.applicantEmail,
        input.applicantName,
        isIndividual ? null : (input.organizationName ?? null),
        organizationDomain,
        input.membershipCategory,
        formSubmissionId,
        now,
        manageTokenHash,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, NULL, 'pending', NULL, 'Application submitted', ?)`,
      )
      .bind(uuid(), id, now),
  );

  await db.batch(statements);

  return { id, manageToken, status: "pending", stage: "pending" };
}

export async function getMemberApplicationById(db: DatabaseLike, id: string): Promise<MemberApplicationRow | null> {
  return first<MemberApplicationRow>(db, `SELECT * FROM member_applications WHERE id = ?`, [id]);
}

/**
 * Verifies an applicant-supplied token against the stored hash for the given
 * application id. Returns the application row on success, null otherwise —
 * callers should treat both "not found" and "bad token" as a generic 401 to
 * avoid leaking whether a given application id exists.
 */
export async function verifyApplicationManageToken(
  db: DatabaseLike,
  applicationId: string,
  token: string,
): Promise<MemberApplicationRow | null> {
  const application = await getMemberApplicationById(db, applicationId);
  if (!application) return null;
  const hash = await sha256Hex(token);
  if (hash !== application.manage_token_hash) return null;
  return application;
}

export interface ApplicationDocumentRow {
  id: string;
  application_id: string;
  uploaded_by_email: string;
  r2_key: string;
  filename: string;
  mime_type: string;
  file_size_bytes: number;
  uploaded_at: string;
}

export async function listApplicationDocuments(
  db: DatabaseLike,
  applicationId: string,
): Promise<ApplicationDocumentRow[]> {
  return all<ApplicationDocumentRow>(
    db,
    `SELECT * FROM application_documents WHERE application_id = ? ORDER BY uploaded_at ASC`,
    [applicationId],
  );
}

export async function recordApplicationDocument(
  db: DatabaseLike,
  params: {
    applicationId: string;
    uploadedByEmail: string;
    r2Key: string;
    filename: string;
    mimeType: string;
    fileSizeBytes: number;
  },
): Promise<ApplicationDocumentRow> {
  const id = uuid();
  const uploadedAt = nowIso();
  await run(
    db,
    `INSERT INTO application_documents
       (id, application_id, uploaded_by_email, r2_key, filename, mime_type, file_size_bytes, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.applicationId,
      params.uploadedByEmail,
      params.r2Key,
      params.filename,
      params.mimeType,
      params.fileSizeBytes,
      uploadedAt,
    ],
  );
  return {
    id,
    application_id: params.applicationId,
    uploaded_by_email: params.uploadedByEmail,
    r2_key: params.r2Key,
    filename: params.filename,
    mime_type: params.mimeType,
    file_size_bytes: params.fileSizeBytes,
    uploaded_at: uploadedAt,
  };
}

/**
 * Reads an application's free-form answers back out of form_submission_answers
 * (PR review fix — member_applications no longer carries its own answers_json
 * blob; answers live in the same forms/form_submissions system event
 * registration forms use, joined via member_applications.form_submission_id).
 */
export async function getApplicationAnswers(
  db: DatabaseLike,
  formSubmissionId: string | null,
): Promise<Record<string, unknown>> {
  if (!formSubmissionId) return {};
  const rows = await all<{ field_key: string; data_json: string | null }>(
    db,
    `SELECT field_key, data_json FROM form_submission_answers WHERE submission_id = ?`,
    [formSubmissionId],
  );
  const answers: Record<string, unknown> = {};
  for (const row of rows) {
    answers[row.field_key] = parseJsonSafe<unknown>(row.data_json, null);
  }
  return answers;
}

// ── Stage machine ─────────────────────────────────────────────────
//
// Replicates the GitHub label state machine as explicit transitions.
// `approved` is deliberately not a destination here — reaching it requires
// the full onboarding orchestration in approveApplication()
// (member-provisioning.ts), not just a status flip, so it's excluded from
// this generic transition function to make that impossible to bypass.

export const ON_HOLD_SUBTYPES = [
  "request_authority",
  "request_org_email",
  "request_pki_experience",
  "request_org_application",
  "request_information",
] as const;
export type OnHoldSubtype = (typeof ON_HOLD_SUBTYPES)[number];
const ON_HOLD_SUBTYPE_SET = new Set<string>(ON_HOLD_SUBTYPES);

const ALLOWED_STAGE_TRANSITIONS: Record<string, string[]> = {
  pending: ["in_review", "withdrawn"],
  in_review: ["on_hold", "in_consultation", "declined", "withdrawn"],
  on_hold: ["in_review", "withdrawn"],
  in_consultation: ["ec_review", "withdrawn"],
  ec_review: ["declined", "withdrawn"],
  approved: [],
  declined: [],
  withdrawn: [],
};

export const ON_HOLD_SUBTYPE_EMAIL_TEMPLATES: Record<OnHoldSubtype, string> = {
  request_authority: "application-hold-authority",
  request_org_email: "application-hold-org-email",
  request_pki_experience: "application-hold-pki-experience",
  request_org_application: "application-hold-org-application",
  request_information: "application-hold-information",
};

const STAGE_EMAIL_TEMPLATES: Partial<Record<string, string>> = {
  in_consultation: "application-in-consultation",
  declined: "application-declined",
};

export function isValidStageTransition(fromStage: string, toStage: string): boolean {
  return (ALLOWED_STAGE_TRANSITIONS[fromStage] ?? []).includes(toStage);
}

export interface StageTransitionResult {
  application: MemberApplicationRow;
  fromStage: string;
  toStage: string;
  /** Email template the caller should queue for the applicant, if any (route layer owns queueEmail — see functions/api/v1/members/applications/index.ts for the convention). */
  suggestedEmailTemplateKey: string | null;
}

/**
 * Applies a stage transition: validates it against the state machine,
 * updates `status`/`stage`/`stage_entered_at` (kept in sync, matching
 * createMemberApplication's convention), writes a member_application_events
 * row, and returns the applicant-facing email template the caller should
 * queue (if any) — this function does not call queueEmail itself, since it
 * has no access to `env`/`executionCtx` (same DB-only/route-owns-email split
 * createMemberApplication's call site already uses).
 */
export async function transitionApplicationStage(
  db: DatabaseLike,
  params: {
    applicationId: string;
    toStage: string;
    actorUserId: string | null;
    onHoldSubtype?: string | null;
    note?: string | null;
  },
): Promise<StageTransitionResult> {
  const application = await getMemberApplicationById(db, params.applicationId);
  if (!application) {
    throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
  }

  if (!isValidStageTransition(application.stage, params.toStage)) {
    throw new AppError(
      409,
      "INVALID_STAGE_TRANSITION",
      `Cannot transition from '${application.stage}' to '${params.toStage}'`,
    );
  }

  if (params.toStage === "on_hold" && !ON_HOLD_SUBTYPE_SET.has(params.onHoldSubtype ?? "")) {
    throw new AppError(422, "ON_HOLD_SUBTYPE_REQUIRED", "A valid on_hold subtype is required");
  }

  const now = nowIso();
  const nextOnHoldSubtype = params.toStage === "on_hold" ? (params.onHoldSubtype as string) : null;

  await db.batch([
    db
      .prepare(
        `UPDATE member_applications
         SET status = ?, stage = ?, stage_entered_at = ?, on_hold_subtype = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(params.toStage, params.toStage, now, nextOnHoldSubtype, now, application.id),
    db
      .prepare(
        `INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(uuid(), application.id, application.stage, params.toStage, params.actorUserId, params.note ?? null, now),
  ]);

  const suggestedEmailTemplateKey =
    params.toStage === "on_hold"
      ? ON_HOLD_SUBTYPE_EMAIL_TEMPLATES[params.onHoldSubtype as OnHoldSubtype]
      : (STAGE_EMAIL_TEMPLATES[params.toStage] ?? null);

  return {
    application: {
      ...application,
      status: params.toStage,
      stage: params.toStage,
      stage_entered_at: now,
      on_hold_subtype: nextOnHoldSubtype,
      updated_at: now,
    },
    fromStage: application.stage,
    toStage: params.toStage,
    suggestedEmailTemplateKey,
  };
}

// ── Communications & notes ────────────────────────────────────────
//
// Two distinct write operations, a templated or
// free-form email to the applicant (recorded here for the staff-only audit
// trail; the actual send goes through the existing email_outbox — this
// function only records that it happened) and an internal note (never
// emailed). Both are staff/processor-only writes; neither is visible to the
// applicant via the token-gated status endpoint.

export interface ApplicationCommunicationRow {
  id: string;
  application_id: string;
  kind: "communication" | "note";
  actor_user_id: string;
  subject: string | null;
  body: string;
  template_key: string | null;
  email_outbox_id: string | null;
  created_at: string;
}

export async function addApplicationCommunication(
  db: DatabaseLike,
  params: {
    applicationId: string;
    actorUserId: string;
    subject: string;
    body: string;
    templateKey?: string | null;
    emailOutboxId?: string | null;
  },
): Promise<ApplicationCommunicationRow> {
  const id = uuid();
  const now = nowIso();
  await run(
    db,
    `INSERT INTO application_communications
       (id, application_id, kind, actor_user_id, subject, body, template_key, email_outbox_id, created_at)
     VALUES (?, ?, 'communication', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.applicationId,
      params.actorUserId,
      params.subject,
      params.body,
      params.templateKey ?? null,
      params.emailOutboxId ?? null,
      now,
    ],
  );
  return {
    id,
    application_id: params.applicationId,
    kind: "communication",
    actor_user_id: params.actorUserId,
    subject: params.subject,
    body: params.body,
    template_key: params.templateKey ?? null,
    email_outbox_id: params.emailOutboxId ?? null,
    created_at: now,
  };
}

export async function addApplicationNote(
  db: DatabaseLike,
  params: { applicationId: string; actorUserId: string; body: string },
): Promise<ApplicationCommunicationRow> {
  const id = uuid();
  const now = nowIso();
  await run(
    db,
    `INSERT INTO application_communications
       (id, application_id, kind, actor_user_id, subject, body, template_key, email_outbox_id, created_at)
     VALUES (?, ?, 'note', ?, NULL, ?, NULL, NULL, ?)`,
    [id, params.applicationId, params.actorUserId, params.body, now],
  );
  return {
    id,
    application_id: params.applicationId,
    kind: "note",
    actor_user_id: params.actorUserId,
    subject: null,
    body: params.body,
    template_key: null,
    email_outbox_id: null,
    created_at: now,
  };
}

export async function listApplicationCommunications(
  db: DatabaseLike,
  applicationId: string,
): Promise<ApplicationCommunicationRow[]> {
  return all<ApplicationCommunicationRow>(
    db,
    `SELECT * FROM application_communications WHERE application_id = ? ORDER BY created_at ASC`,
    [applicationId],
  );
}

// ── Member consultation concerns ──────────────────────────────────
//
// Visible only to staff/processors, never to the applicant — enforced by
// omission: no public/token-gated endpoint reads this table.

export interface ApplicationConcernRow {
  id: string;
  application_id: string;
  submitted_by_user_id: string;
  concern_text: string;
  created_at: string;
}

export async function submitApplicationConcern(
  db: DatabaseLike,
  params: { applicationId: string; submittedByUserId: string; concernText: string },
): Promise<ApplicationConcernRow> {
  const application = await getMemberApplicationById(db, params.applicationId);
  if (!application) {
    throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
  }
  if (application.stage !== "in_consultation") {
    throw new AppError(409, "APPLICATION_NOT_IN_CONSULTATION", "Concerns can only be submitted during consultation");
  }

  const id = uuid();
  const now = nowIso();
  await run(
    db,
    `INSERT INTO application_concerns (id, application_id, submitted_by_user_id, concern_text, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, params.applicationId, params.submittedByUserId, params.concernText, now],
  );
  return {
    id,
    application_id: params.applicationId,
    submitted_by_user_id: params.submittedByUserId,
    concern_text: params.concernText,
    created_at: now,
  };
}

export async function listApplicationConcerns(
  db: DatabaseLike,
  applicationId: string,
): Promise<ApplicationConcernRow[]> {
  return all<ApplicationConcernRow>(
    db,
    `SELECT * FROM application_concerns WHERE application_id = ? ORDER BY created_at ASC`,
    [applicationId],
  );
}
