/**
 * Atomic membership-application submission use case.
 *
 * The route validates the transport envelope and rate limit. This service
 * owns the complete durable command: resolve and validate the active form,
 * create its normalized answer rows, create the application and initial
 * event, enqueue the confirmation, and write the audit record in one D1
 * transaction.
 *
 * An organization applies through the identity of the person who represents
 * it: their email challenge already linked the organization and its domain,
 * so an application only asks for membership and never holds a domain.
 */
import { requireCategoryWorkflow, prepareMembershipWorkflowPin } from "../workflows/pinning";
import { prepareQueueEmailStatement } from "../../../email/outbox";
import { AppError } from "../../../errors";
import { prepareAuditLog } from "../../audit";
import {
  formSubmissionContextChangedError,
  isFormSubmissionContextConflict,
  prepareCreateFormSubmission,
  validateCustomAnswersAgainstForm,
} from "../../forms";
import { randomToken, sha256Hex } from "../../../utils/crypto";
import { uuid } from "../../../utils/ids";
import { nowIso } from "../../../utils/time";
import {
  MEMBERSHIP_APPLICATION_FORM_KEY,
  isMembershipApplicationIdentityFieldKey,
  membershipApplicationFields,
} from "../../../../../assets/shared/schemas/membership-application-form";
import { prepareApplicationWorkingGroups, type ApplicationWorkingGroupRow } from "../application-groups";
import { prepareGlobalFormDefinition } from "../../forms/read";
import { batchFirst, batchRows } from "../../../db/pagination";
import { requireMembershipApplicationPolicyFields } from "../application-form";
import { organizationDomainClaimForEmailSelection } from "../organization-domain-claims";
import { prepareMembershipCategoryRead, requireMembershipCategoryResult } from "../categories";
import { prepareMembershipWorkflowVersionRead } from "../workflows/catalog";
import { membershipApplicantPolicySchema } from "../../../../../assets/shared/schemas/membership-applicant-policy";
import { mailboxKind, workEmailDomain } from "../../../email-domains/classification";
import {
  APPLICATION_ALREADY_PENDING,
  APPLICATION_ALREADY_PENDING_MESSAGE,
  APPLICATION_CHANGED,
  APPLICATION_CHANGED_MESSAGE,
  INDIVIDUAL_ALREADY_MEMBER,
  INDIVIDUAL_ALREADY_MEMBER_MESSAGE,
  INDIVIDUAL_WHILE_REPRESENTING,
  ORGANIZATION_ALREADY_MEMBER,
  ORGANIZATION_IDENTITY_REQUIRED,
  ORGANIZATION_IDENTITY_REQUIRED_MESSAGE,
  individualWhileRepresentingMessage,
  organizationAlreadyMemberMessage,
  organizationApplicationPendingMessage,
} from "../../../../../assets/shared/membership-application-refusals";
import {
  readMembershipApplicationConflicts,
  prepareMembershipApplicationConflictGuards,
  type MembershipApplicationConflictInput,
} from "./conflicts";
import { splitPersonName } from "../../users";
import { firstNameSchema, lastNameSchema } from "../../../../../assets/shared/schemas/api-common";
import type { DatabaseLike, StatementLike } from "../../../types";
import {
  isAuthorizationGuardFailure,
  isStateGuardFailure,
  prepareAuthorizationGuard,
} from "../../../db/authorization-guard";

/**
 * Refuses an application whose outcome is already decided before review: the
 * organization or the applicant is already a member, an individual applicant
 * represents an organization, or an application for the same person or
 * organization is still open (issue #27 and its follow-ups).
 *
 * The organization is matched by its id, and an older application that only
 * names it by that name, the same way readiness and the organization's current
 * application match it. The person is matched by their account, never by a
 * typed name; their verified address also matches an open application. Being
 * an `organizations` row is not enough: the refusal is about membership, and
 * an organization can exist without one.
 */
async function refuseConflictingApplication(
  db: DatabaseLike,
  input: MembershipApplicationConflictInput,
): Promise<void> {
  const conflicts = await readMembershipApplicationConflicts(db, input);
  const typedOrganization = !input.organizationId && input.organizationName;
  if (conflicts.memberOrganization) {
    const message = organizationAlreadyMemberMessage(conflicts.memberOrganization);
    // Carried as a field error as well as a sentence when the name was typed,
    // so the refusal lands on the box the applicant would have to change.
    throw new AppError(409, ORGANIZATION_ALREADY_MEMBER, message, {
      formErrors: [message],
      fieldErrors: typedOrganization
        ? { organizationName: [`The consortium already has ${conflicts.memberOrganization} as a member.`] }
        : {},
    });
  }
  if (conflicts.individualMember)
    throw new AppError(409, INDIVIDUAL_ALREADY_MEMBER, INDIVIDUAL_ALREADY_MEMBER_MESSAGE, {
      formErrors: [INDIVIDUAL_ALREADY_MEMBER_MESSAGE],
      fieldErrors: {},
    });
  if (conflicts.representedOrganization) {
    const message = individualWhileRepresentingMessage(conflicts.representedOrganization);
    throw new AppError(409, INDIVIDUAL_WHILE_REPRESENTING, message, { formErrors: [message], fieldErrors: {} });
  }
  if (conflicts.pendingForApplicant)
    throw new AppError(409, APPLICATION_ALREADY_PENDING, APPLICATION_ALREADY_PENDING_MESSAGE, {
      formErrors: [APPLICATION_ALREADY_PENDING_MESSAGE],
      fieldErrors: {},
    });
  if (conflicts.pendingOrganization) {
    const message = organizationApplicationPendingMessage(conflicts.pendingOrganization);
    throw new AppError(409, APPLICATION_ALREADY_PENDING, message, {
      formErrors: [message],
      fieldErrors: typedOrganization ? { organizationName: [message] } : {},
    });
  }
}

/** The applicant's typed name, split for the account; null when the account rules refuse a part. */
function accountNamesFromApplicant(applicantName: string) {
  const { firstName, lastName } = splitPersonName(applicantName);
  // An application accepts any name up to its length; one the account rules refuse waits for approval, as before.
  if (
    (firstName !== null && !firstNameSchema.safeParse(firstName).success) ||
    (lastName !== null && !lastNameSchema.safeParse(lastName).success)
  )
    return null;
  return { firstName, lastName };
}

/**
 * A signed-in applicant's account can still lack the names the join form asked for, since starting an account
 * asks none. The application fills only what is absent; names the person already saved stay theirs.
 */
function prepareApplicantAccountNames(db: DatabaseLike, userId: string, applicantName: string, at: string) {
  const names = accountNamesFromApplicant(applicantName);
  if (!names) return [];
  return [
    db
      .prepare(
        `UPDATE users SET first_name = COALESCE(first_name, ?), last_name = COALESCE(last_name, ?), updated_at = ?
          WHERE id = ? AND (first_name IS NULL OR last_name IS NULL)`,
      )
      .bind(names.firstName, names.lastName, at, userId),
  ];
}

export interface CreateMemberApplicationInput {
  applicantEmail: string;
  applicantName: string;
  membershipCategory: string;
  organizationName?: string | null;
  answers?: Record<string, unknown>;
  appBaseUrl: string;
  /** The verified-email link the application was made through; null when a signed-in identity applies. */
  joinCapabilityId: string | null;
  applicantKind: "organization" | "individual";
  /** The signed-in account that applies; the application never creates one. */
  applicantUserId: string;
  /**
   * The identity a signed-in applicant applies as; its holding is rechecked when the application commits.
   * An organization application requires one.
   */
  applicantIdentityId?: string | null;
  /** The organization of that identity, matched by id rather than by name. */
  organizationId?: string | null;
  /**
   * Answers copied from that identity (title, first link, bio). They replace
   * whatever the request sent under those keys and are kept as the
   * application's record of who applied.
   */
  identityAnswers?: Record<string, string>;
}

export interface CreateMemberApplicationResult {
  id: string;
  manageToken: string;
  stage: "submitted";
  outboxId: string;
}

function translateApplicationConflict(error: unknown): never {
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
  throw error;
}

export async function createMemberApplication(
  db: DatabaseLike,
  input: CreateMemberApplicationInput,
): Promise<CreateMemberApplicationResult> {
  const organizationId = input.organizationId;
  const categoryRead = prepareMembershipCategoryRead(db, input.membershipCategory);
  const workflowRead = prepareMembershipWorkflowVersionRead(db, {
    sql: "SELECT workflow_version_id FROM membership_categories WHERE code = ?",
    bindings: [input.membershipCategory],
  });
  const formRead = prepareGlobalFormDefinition(db, MEMBERSHIP_APPLICATION_FORM_KEY);
  const groupsRead = prepareApplicationWorkingGroups(db, {
    sql: "SELECT ? AS code",
    bindings: [input.membershipCategory],
  });
  // The domain the applicant's address links through, kept so staff edits of the address stay on it.
  const domainRead = organizationDomainClaimForEmailSelection(input.applicantEmail);
  const results = await db.batch([
    categoryRead.statement,
    workflowRead.statement,
    ...formRead.statements,
    groupsRead.statement,
    db.prepare(domainRead.sql).bind(...domainRead.bindings),
  ]);
  const category = requireMembershipCategoryResult(categoryRead.decode(results[0]), input.membershipCategory);
  const workflow = await requireCategoryWorkflow(
    db,
    category,
    category.active && category.workflowVersionId ? workflowRead.decode(results[1]) : null,
  );
  const isIndividual = category.isIndividual;
  if (!isIndividual && !(input.applicantIdentityId && organizationId))
    throw new AppError(409, ORGANIZATION_IDENTITY_REQUIRED, ORGANIZATION_IDENTITY_REQUIRED_MESSAGE, {
      formErrors: [ORGANIZATION_IDENTITY_REQUIRED_MESSAGE],
      fieldErrors: {},
    });
  const applicantPolicy = membershipApplicantPolicySchema(category, mailboxKind(input.applicantEmail)).safeParse({
    applicantEmail: input.applicantEmail,
    organizationName: input.organizationName ?? undefined,
  });
  if (!applicantPolicy.success)
    throw new AppError(422, "VALIDATION_ERROR", "Check the category requirements", applicantPolicy.error.flatten());
  const form = formRead.decode(results.slice(2, 2 + formRead.statements.length));
  if (!form) {
    throw new AppError(503, "APPLICATION_FORM_UNAVAILABLE", "The membership application form is unavailable");
  }
  requireMembershipApplicationPolicyFields(form.fields);

  form.fields = membershipApplicationFields(form.fields, {
    isIndividual,
    eligibleWorkingGroupIds:
      groupsRead
        .decode(batchRows<ApplicationWorkingGroupRow>(results[2 + formRead.statements.length]))
        .get(category.code) ?? [],
  });
  const knownKeys = new Set(form.fields.map((field) => field.key));
  const customAnswers = input.identityAnswers
    ? {
        ...Object.fromEntries(
          Object.entries(input.answers ?? {}).filter(([key]) => !isMembershipApplicationIdentityFieldKey(key)),
        ),
        ...Object.fromEntries(Object.entries(input.identityAnswers).filter(([key]) => knownKeys.has(key))),
      }
    : input.answers;
  const answers = await validateCustomAnswersAgainstForm(form, {
    customAnswers,
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
  if (isIndividual !== (input.applicantKind === "individual")) {
    throw new AppError(
      422,
      "MEMBERSHIP_CATEGORY_TYPE_MISMATCH",
      "The membership category is not eligible for this verified join path",
    );
  }
  const conflictInput = {
    isIndividual,
    organizationName: isIndividual ? null : (input.organizationName ?? null),
    organizationId: isIndividual ? null : (organizationId ?? null),
    applicantUserId: input.applicantUserId,
    applicantEmail: input.applicantEmail,
  };
  // A record of the domain the applicant's address links through; the application never claims it.
  const organizationDomain = isIndividual
    ? null
    : (batchFirst<{ domain: string }>(results[3 + formRead.statements.length])?.domain ??
      workEmailDomain(input.applicantEmail));
  const statusUrl = `${input.appBaseUrl}/application-status/?id=${encodeURIComponent(id)}&token=${encodeURIComponent(manageToken)}`;

  const statements: StatementLike[] = [
    ...prepareMembershipApplicationConflictGuards(db, conflictInput),
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
    ...prepareApplicantAccountNames(db, input.applicantUserId, input.applicantName, now),
    ...(input.applicantIdentityId
      ? [
          prepareAuthorizationGuard(db, {
            sql: `SELECT 1 FROM identities
                   WHERE id = ? AND user_id = ? AND organization_id IS ?
                     AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL`,
            bindings: [input.applicantIdentityId, input.applicantUserId, organizationId ?? null],
          }),
        ]
      : []),
    ...formSubmission.statements,
    db
      .prepare(
        `INSERT INTO member_applications
           (id, applicant_user_id, applicant_email, applicant_name, organization_name, organization_id, organization_domain,
            membership_category, form_submission_id, join_capability_id, stage, stage_entered_at,
            manage_token_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.applicantUserId,
        input.applicantEmail,
        input.applicantName,
        isIndividual ? null : (input.organizationName ?? null),
        isIndividual ? null : (organizationId ?? null),
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

  statements.push(...prepareMembershipWorkflowPin(db, id, category, workflow, 1, now));

  statements.push(
    db
      .prepare(
        `INSERT INTO member_application_events
           (id, application_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, NULL, 'submitted', NULL, 'Application submitted', ?)`,
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
      { applicantEmail: input.applicantEmail, membershipCategory: input.membershipCategory },
      now,
    ),
  );

  try {
    await db.batch(statements);
  } catch (error) {
    if (isStateGuardFailure(error)) {
      await refuseConflictingApplication(db, conflictInput);
      throw new AppError(409, APPLICATION_CHANGED, APPLICATION_CHANGED_MESSAGE, {
        formErrors: [APPLICATION_CHANGED_MESSAGE],
        fieldErrors: {},
      });
    }
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "MEMBER_JOIN_CONTEXT_CHANGED",
        "Your verified identity or the category policy changed. Reload the application form and retry.",
      );
    }
    return translateApplicationConflict(error);
  }

  return { id, manageToken, stage: "submitted", outboxId: confirmation.id };
}
