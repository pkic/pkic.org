/**
 * Membership application submission. Split out of the former
 * member-applications.ts (PR #1 review §1.5) — queries.ts owns reads,
 * transition.ts owns the stage machine, this file owns everything to do
 * with creating a new application and the domain-duplicate checks that
 * gate it.
 */
import { first } from "../../../db/queries";
import { uuid } from "../../../utils/ids";
import { nowIso } from "../../../utils/time";
import { randomToken, sha256Hex } from "../../../utils/crypto";
import { getGlobalFormByKey } from "../../forms";
import {
  MEMBERSHIP_CATEGORIES,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
  VOTING_CATEGORIES,
} from "../../../../../assets/shared/schemas/membership-categories";
import { APPLICATION_STAGES } from "../../../../../assets/shared/schemas/member-applications";
import type { DatabaseLike } from "../../../types";

/** `forms.key` for the portal-managed membership application form (seeded in migrations/0034). */
export const MEMBERSHIP_APPLICATION_FORM_KEY = "membership-application";

export { MEMBERSHIP_CATEGORIES, INDIVIDUAL_MEMBERSHIP_CATEGORIES, VOTING_CATEGORIES };

/** member_applications.status/stage — derived from the canonical shared vocabulary (PR #1 review §1.3), not re-declared. */
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

/** Non-terminal application stages — an application in one of these still "counts" for duplicate-domain detection. */
const ACTIVE_APPLICATION_STATUSES: ApplicationStage[] = [
  "pending",
  "in_review",
  "on_hold",
  "in_consultation",
  "ec_review",
  "approved",
];

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
