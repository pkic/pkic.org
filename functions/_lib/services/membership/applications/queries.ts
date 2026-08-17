/**
 * Membership application read models and the staff-only communications/
 * notes/concerns log. Split out of the former member-applications.ts
 * (PR #1 review §1.5) — create.ts owns submission, transition.ts owns the
 * stage machine, this file owns everything that reads an application back
 * or records something against it without changing its stage.
 */
import { all, first, run } from "../../../db/queries";
import { uuid } from "../../../utils/ids";
import { nowIso } from "../../../utils/time";
import { sha256Hex } from "../../../utils/crypto";
import { parseJsonSafe } from "../../../utils/json";
import { AppError } from "../../../errors";
import type { DatabaseLike } from "../../../types";

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
