/**
 * Membership application read models and the staff-only communications/
 * notes log. Split out of the former member-applications.ts
 * (PR #1 review §1.5) — create.ts owns submission, transition.ts owns the
 * stage machine, this file owns everything that reads an application back
 * or records something against it without changing its stage.
 */
import { verifyCapabilityToken } from "../../../auth/capability-links";
import { all, first } from "../../../db/queries";
import { uuid } from "../../../utils/ids";
import { nowIso } from "../../../utils/time";
import { sha256Hex } from "../../../utils/crypto";
import { parseJsonSafe } from "../../../utils/json";
import type { DatabaseLike, StatementLike } from "../../../types";

export interface MemberApplicationRow {
  id: string;
  applicant_user_id: string | null;
  member_id: string | null;
  applicant_email: string;
  applicant_name: string;
  organization_name: string | null;
  organization_domain: string | null;
  membership_category: string;
  form_submission_id: string | null;
  stage: string;
  stage_entered_at: string;
  transition_revision: number;
  on_hold_subtype: string | null;
  on_hold_reminder_sent_at: string | null;
  review_notes: string | null;
  assigned_to_user_id: string | null;
  manage_token_hash: string;
  created_at: string;
  updated_at: string;
}

export async function getMemberApplicationById(db: DatabaseLike, id: string): Promise<MemberApplicationRow | null> {
  return first<MemberApplicationRow>(
    db,
    `SELECT id, applicant_user_id, member_id, applicant_email, applicant_name, organization_name, organization_domain,
            membership_category, form_submission_id, stage, stage_entered_at, transition_revision,
            on_hold_subtype, on_hold_reminder_sent_at, review_notes, assigned_to_user_id, manage_token_hash,
            created_at, updated_at
     FROM member_applications
     WHERE id = ?`,
    [id],
  );
}

/**
 * Verifies an applicant-supplied token against the stored hash for the given
 * application id. Returns the application row on success, null otherwise —
 * callers should treat both "not found" and "bad token" as a generic 401 to
 * avoid leaking whether a given application id exists.
 */
export async function verifyApplicationStatusToken(
  db: DatabaseLike,
  applicationId: string,
  token: string,
  signingSecret?: string,
): Promise<MemberApplicationRow | null> {
  const application = await getMemberApplicationById(db, applicationId);
  if (!application) return null;
  const hash = await sha256Hex(token);
  if (hash === application.manage_token_hash) return application;
  if (!signingSecret) return null;
  const verified = await verifyCapabilityToken({
    signingSecret,
    linkSecret: `${application.manage_token_hash}\n${application.applicant_email}`,
    purpose: "application_status",
    token,
  });
  return verified.ok && verified.resourceId === application.id ? application : null;
}

/** Document management requires the original token, never a status-only email link. */
export function verifyApplicationManageToken(db: DatabaseLike, applicationId: string, token: string) {
  return verifyApplicationStatusToken(db, applicationId, token);
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
  const prepared = prepareApplicationCommunication(db, params);
  await db.batch([prepared.statement]);
  return prepared.communication;
}

export function prepareApplicationCommunication(
  db: DatabaseLike,
  params: {
    applicationId: string;
    actorUserId: string;
    subject: string;
    body: string;
    templateKey?: string | null;
    emailOutboxId?: string | null;
  },
): { communication: ApplicationCommunicationRow; statement: StatementLike } {
  const id = uuid();
  const now = nowIso();
  const statement = db
    .prepare(
      `INSERT INTO application_communications
       (id, application_id, kind, actor_user_id, subject, body, template_key, email_outbox_id, created_at)
     VALUES (?, ?, 'communication', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      params.applicationId,
      params.actorUserId,
      params.subject,
      params.body,
      params.templateKey ?? null,
      params.emailOutboxId ?? null,
      now,
    );
  return {
    statement,
    communication: {
      id,
      application_id: params.applicationId,
      kind: "communication",
      actor_user_id: params.actorUserId,
      subject: params.subject,
      body: params.body,
      template_key: params.templateKey ?? null,
      email_outbox_id: params.emailOutboxId ?? null,
      created_at: now,
    },
  };
}

export async function addApplicationNote(
  db: DatabaseLike,
  params: { applicationId: string; actorUserId: string; body: string },
): Promise<ApplicationCommunicationRow> {
  const prepared = prepareApplicationNote(db, params);
  await db.batch([prepared.statement]);
  return prepared.note;
}

export function prepareApplicationNote(
  db: DatabaseLike,
  params: { applicationId: string; actorUserId: string; body: string },
): { note: ApplicationCommunicationRow; statement: StatementLike } {
  const id = uuid();
  const now = nowIso();
  const statement = db
    .prepare(
      `INSERT INTO application_communications
       (id, application_id, kind, actor_user_id, subject, body, template_key, email_outbox_id, created_at)
     VALUES (?, ?, 'note', ?, NULL, ?, NULL, NULL, ?)`,
    )
    .bind(id, params.applicationId, params.actorUserId, params.body, now);
  return {
    statement,
    note: {
      id,
      application_id: params.applicationId,
      kind: "note",
      actor_user_id: params.actorUserId,
      subject: null,
      body: params.body,
      template_key: null,
      email_outbox_id: null,
      created_at: now,
    },
  };
}

export async function listApplicationCommunications(
  db: DatabaseLike,
  applicationId: string,
): Promise<ApplicationCommunicationRow[]> {
  return all<ApplicationCommunicationRow>(
    db,
    `SELECT id, application_id, kind, actor_user_id, subject, body, template_key, email_outbox_id, created_at
     FROM application_communications
     WHERE application_id = ?
     ORDER BY created_at ASC, id ASC`,
    [applicationId],
  );
}

export async function getRequestedApplicationGroups(db: DatabaseLike, answers: Record<string, unknown>) {
  const raw = answers.working_groups ?? answers.workingGroups;
  const requested = Array.isArray(raw)
    ? [...new Set(raw.filter((value): value is string => typeof value === "string"))].slice(0, 200)
    : [];
  if (!requested.length) return [];
  const rows = await all<{ id: string; slug: string; name: string }>(
    db,
    `SELECT id, slug, name FROM groups WHERE type_key = 'working_group'
    AND (slug IN (SELECT value FROM json_each(?)) OR id IN (SELECT value FROM json_each(?)))`,
    [JSON.stringify(requested), JSON.stringify(requested)],
  );
  const labels = new Map(rows.flatMap((row) => [[row.id, row] as const, [row.slug, row] as const]));
  return requested.map((value) => ({ slug: labels.get(value)?.slug ?? value, name: labels.get(value)?.name ?? value }));
}
