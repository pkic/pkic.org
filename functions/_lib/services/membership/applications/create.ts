/**
 * Atomic membership-application submission use case.
 *
 * The route validates the transport envelope and rate limit. This service
 * owns the complete durable command: resolve and validate the active form,
 * create its normalized answer rows, create the application and initial
 * event, reserve an organization domain, enqueue the confirmation, and
 * write the audit record in one D1 transaction.
 */
import { prepareQueueEmailStatement } from "../../../email/outbox";
import { AppError } from "../../../errors";
import { prepareAuditLog } from "../../audit";
import {
  formSubmissionContextChangedError,
  getGlobalFormByKey,
  isFormSubmissionContextConflict,
  prepareCreateFormSubmission,
  validateCustomAnswersAgainstForm,
} from "../../forms";
import { randomToken, sha256Hex } from "../../../utils/crypto";
import { uuid } from "../../../utils/ids";
import { nowIso } from "../../../utils/time";
import { MEMBERSHIP_APPLICATION_FORM_KEY } from "../../../../../assets/shared/schemas/membership-application-form";
import { requireMembershipApplicationPolicyFields } from "../application-form";
import { getOrganizationDomainClaim, prepareClaimDomainForApplication } from "../organization-domain-claims";
import {
  MEMBERSHIP_CATEGORIES,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
} from "../../../../../assets/shared/schemas/membership-categories";
import type { DatabaseLike, StatementLike } from "../../../types";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../../db/authorization-guard";

export { MEMBERSHIP_CATEGORIES, INDIVIDUAL_MEMBERSHIP_CATEGORIES };

export function emailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

export interface CreateMemberApplicationInput {
  applicantEmail: string;
  applicantName: string;
  membershipCategory: string;
  organizationName?: string | null;
  answers?: Record<string, unknown>;
  appBaseUrl: string;
  joinCapabilityId: string;
  applicantKind: "organization" | "individual";
  applicantUserId: string | null;
}

export interface CreateMemberApplicationResult {
  id: string;
  manageToken: string;
  stage: "pending";
  outboxId: string;
}

async function translateDomainClaimConflict(
  db: DatabaseLike,
  domain: string | null,
  applicationId: string,
  error: unknown,
): Promise<never> {
  if (
    error instanceof Error &&
    (error.message.includes("uq_member_applications_join_capability") ||
      error.message.includes("member_applications.join_capability_id"))
  ) {
    throw new AppError(409, "MEMBER_JOIN_CAPABILITY_USED", "This verified application link has already been used");
  }
  if (isFormSubmissionContextConflict(error)) {
    throw formSubmissionContextChangedError();
  }
  if (domain) {
    const claim = await getOrganizationDomainClaim(db, domain);
    if (claim && claim.applicationId !== applicationId) {
      throw new AppError(409, "DUPLICATE_APPLICATION", "This organization domain is already claimed");
    }
  }
  throw error;
}

export async function createMemberApplication(
  db: DatabaseLike,
  input: CreateMemberApplicationInput,
): Promise<CreateMemberApplicationResult> {
  const form = await getGlobalFormByKey(db, MEMBERSHIP_APPLICATION_FORM_KEY);
  if (!form) {
    throw new AppError(503, "APPLICATION_FORM_UNAVAILABLE", "The membership application form is unavailable");
  }
  requireMembershipApplicationPolicyFields(form.fields);

  const answers = await validateCustomAnswersAgainstForm(form, {
    customAnswers: input.answers,
    errorStatus: 422,
  });

  const id = uuid();
  const now = nowIso();
  const formSubmission = prepareCreateFormSubmission(
    db,
    form,
    { submittedByUserId: null, contextType: "membership", contextRef: id },
    answers,
    now,
  );
  const manageToken = randomToken(24);
  const manageTokenHash = await sha256Hex(manageToken);
  const isIndividual = INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(input.membershipCategory);
  if (isIndividual !== (input.applicantKind === "individual")) {
    throw new AppError(
      422,
      "MEMBERSHIP_CATEGORY_TYPE_MISMATCH",
      "The membership category is not eligible for this verified join path",
    );
  }
  const organizationDomain = isIndividual ? null : emailDomain(input.applicantEmail);
  const statusUrl = `${input.appBaseUrl}/application-status/?id=${encodeURIComponent(id)}&token=${encodeURIComponent(manageToken)}`;

  const statements: StatementLike[] = [
    ...(input.applicantUserId
      ? [
          prepareAuthorizationGuard(db, {
            sql: `SELECT 1 FROM users user
                   WHERE user.id = ? AND user.active = 1
                     AND user.pii_redacted_at IS NULL AND user.merged_into_user_id IS NULL
                     AND (
                       user.normalized_email = ?
                       OR EXISTS (
                         SELECT 1 FROM user_emails alias
                          WHERE alias.user_id = user.id
                            AND alias.normalized_email = ?
                            AND alias.verified_at IS NOT NULL
                       )
                     )`,
            bindings: [input.applicantUserId, input.applicantEmail, input.applicantEmail],
          }),
        ]
      : []),
    ...formSubmission.statements,
    db
      .prepare(
        `INSERT INTO member_applications
           (id, applicant_user_id, applicant_email, applicant_name, organization_name, organization_domain,
            membership_category, form_submission_id, join_capability_id, stage, stage_entered_at,
            manage_token_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.applicantUserId,
        input.applicantEmail,
        input.applicantName,
        isIndividual ? null : (input.organizationName ?? null),
        organizationDomain,
        input.membershipCategory,
        formSubmission.id,
        input.joinCapabilityId,
        now,
        manageTokenHash,
        now,
        now,
      ),
  ];

  if (organizationDomain) {
    statements.push(prepareClaimDomainForApplication(db, organizationDomain, id, now));
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO member_application_events
           (id, application_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, NULL, 'pending', NULL, 'Application submitted', ?)`,
      )
      .bind(uuid(), id, now),
  );

  const confirmation = prepareQueueEmailStatement(
    db,
    {
      templateKey: "application-received",
      recipientEmail: input.applicantEmail,
      messageType: "transactional",
      subject: "We received your PKI Consortium membership application",
      data: { applicantName: input.applicantName, statusUrl },
    },
    now,
  );
  statements.push(
    confirmation.statement,
    prepareAuditLog(
      db,
      "public",
      null,
      "member_application_submitted",
      "member_application",
      id,
      {
        applicantEmail: input.applicantEmail,
        membershipCategory: input.membershipCategory,
      },
      now,
    ),
  );

  try {
    await db.batch(statements);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "MEMBER_JOIN_IDENTITY_CHANGED",
        "The verified account email changed before the application was submitted",
      );
    }
    return translateDomainClaimConflict(db, organizationDomain, id, error);
  }

  return { id, manageToken, stage: "pending", outboxId: confirmation.id };
}
