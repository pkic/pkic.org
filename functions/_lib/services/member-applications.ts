import { all, first, run } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { randomToken, sha256Hex } from "../utils/crypto";
import { stringifyJson, parseJsonSafe } from "../utils/json";
import type { DatabaseLike } from "../types";

/** Individual (org-less) membership categories — PRD §0.1. */
export const INDIVIDUAL_MEMBERSHIP_CATEGORIES = new Set(["H5", "H6", "H7"]);

export const MEMBERSHIP_CATEGORIES = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "H7",
  "H8",
] as const;

/** Non-terminal application stages — an application in one of these still "counts" for duplicate-domain detection. */
const ACTIVE_APPLICATION_STATUSES = ["pending", "in_review", "on_hold", "in_consultation", "ec_review", "approved"];

export interface MemberApplicationRow {
  id: string;
  applicant_email: string;
  applicant_name: string;
  organization_name: string | null;
  organization_domain: string | null;
  membership_category: string;
  answers_json: string | null;
  status: string;
  stage: string;
  stage_entered_at: string;
  review_notes: string | null;
  manage_token_hash: string;
  created_at: string;
  updated_at: string;
}

export function emailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/**
 * Returns true when an active (non-terminal) application already exists for
 * the given organization domain. Only checks member_applications — the
 * `organizations` table has no domain column yet (added when Phase 4A
 * builds org onboarding), so this can't yet also catch an already-approved
 * member's domain. See prd.md Phase 1 notes.
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

  await db.batch([
    db
      .prepare(
        `INSERT INTO member_applications
           (id, applicant_email, applicant_name, organization_name, organization_domain,
            membership_category, answers_json, status, stage, stage_entered_at,
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
        input.answers ? stringifyJson(input.answers) : null,
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
  ]);

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

export function parseApplicationAnswers(answersJson: string | null): Record<string, unknown> {
  return parseJsonSafe<Record<string, unknown>>(answersJson, {});
}
