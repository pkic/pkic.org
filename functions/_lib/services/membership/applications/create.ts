/**
 * Atomic membership-application submission use case.
 *
 * The route validates the transport envelope and rate limit. This service
 * owns the complete durable command: resolve and validate the active form,
 * create its normalized answer rows, create the application and initial
 * event, reserve an organization domain, enqueue the confirmation, and
 * write the audit record in one D1 transaction.
 */
import { requireCategoryWorkflow, prepareMembershipWorkflowPin } from "../workflows/pinning";
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
import {
  MEMBERSHIP_APPLICATION_FORM_KEY,
  isMembershipApplicationIdentityFieldKey,
  membershipApplicationFields,
} from "../../../../../assets/shared/schemas/membership-application-form";
import { eligibleApplicationWorkingGroupIds } from "../application-groups";
import { requireMembershipApplicationPolicyFields } from "../application-form";
import {
  getOrganizationDomainClaim,
  organizationLinkDomain,
  prepareClaimDomainForApplication,
} from "../organization-domain-claims";
import { requireMembershipCategory } from "../categories";
import { membershipApplicantPolicySchema } from "../../../../../assets/shared/schemas/membership-applicant-policy";
import { mailboxKind } from "../../../email-domains/classification";
import {
  APPLICATION_ALREADY_PENDING,
  APPLICATION_ALREADY_PENDING_MESSAGE,
  INDIVIDUAL_ALREADY_MEMBER,
  INDIVIDUAL_ALREADY_MEMBER_MESSAGE,
  INDIVIDUAL_WHILE_REPRESENTING,
  ORGANIZATION_ALREADY_MEMBER,
  ORGANIZATION_DOMAIN_APPLICATION_PENDING_MESSAGE,
  individualWhileRepresentingMessage,
  organizationAlreadyMemberMessage,
  organizationApplicationPendingMessage,
} from "../../../../../assets/shared/membership-application-refusals";
import { readMembershipApplicationConflicts } from "./conflicts";
import { buildFindOrCreateUserStatement, findUserByEmail, splitPersonName } from "../../users";
import { prepareVerifyOwnedEmailStatements } from "../../email-verification";
import { normalizeEmail } from "../../../validation";
import { firstNameSchema, lastNameSchema } from "../../../../../assets/shared/schemas/api-common";
import type { DatabaseLike, StatementLike } from "../../../types";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../../db/authorization-guard";

/**
 * Refuses an application whose outcome is already decided before review: the
 * organization or the applicant is already a member, an individual applicant
 * represents an organization, or an application for the same person or
 * organization is still open (issue #27 and its follow-ups).
 *
 * The organization is matched by its id when the applicant applies as an
 * organization identity, and otherwise by its name, compared the way every
 * other surface compares it. The person is matched by their account, never by
 * a typed name or address; a submission without an account (a verified
 * mailbox nobody holds yet) is matched by that verified address only for an
 * open application. Being an `organizations` row is not enough: the refusal
 * is about membership, and an organization can exist without one.
 */
async function refuseConflictingApplication(
  db: DatabaseLike,
  input: {
    isIndividual: boolean;
    organizationName: string | null;
    organizationId: string | null;
    applicantUserId: string | null;
    applicantEmail: string;
  },
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

/**
 * The account a verified applicant signs in with to follow their application. The join link proved the
 * mailbox, so an address nobody holds yet gets its account now rather than at approval; an address that
 * already belongs to a person keeps its existing path.
 */
async function prepareApplicantAccount(
  db: DatabaseLike,
  input: Pick<CreateMemberApplicationInput, "applicantEmail" | "applicantName" | "applicantUserId">,
) {
  if (input.applicantUserId || (await findUserByEmail(db, input.applicantEmail))) return null;
  const { firstName, lastName } = splitPersonName(input.applicantName);
  // An application accepts any name up to its length; one the account rules refuse waits for approval, as before.
  if (
    (firstName !== null && !firstNameSchema.safeParse(firstName).success) ||
    (lastName !== null && !lastNameSchema.safeParse(lastName).success)
  )
    return null;
  const account = await buildFindOrCreateUserStatement(db, {
    email: input.applicantEmail,
    firstName: firstName ?? undefined,
    lastName: lastName ?? undefined,
    mailboxVerified: true,
    // The membership identity is created at approval; until then the account only follows the application.
    identityInBatch: true,
  });
  account.statements.push(
    ...prepareVerifyOwnedEmailStatements(db, {
      userId: account.user.id,
      normalizedEmail: normalizeEmail(input.applicantEmail),
      method: "magic_link",
    }),
  );
  return account;
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
  applicantUserId: string | null;
  /** The identity a signed-in applicant applies as; its holding is rechecked when the application commits. */
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
      throw new AppError(409, APPLICATION_ALREADY_PENDING, ORGANIZATION_DOMAIN_APPLICATION_PENDING_MESSAGE, {
        formErrors: [ORGANIZATION_DOMAIN_APPLICATION_PENDING_MESSAGE],
        fieldErrors: {},
      });
    }
  }
  throw error;
}

export async function createMemberApplication(
  db: DatabaseLike,
  input: CreateMemberApplicationInput,
): Promise<CreateMemberApplicationResult> {
  const category = await requireMembershipCategory(db, input.membershipCategory);
  const workflow = await requireCategoryWorkflow(db, category);
  const isIndividual = category.isIndividual;
  const applicantPolicy = membershipApplicantPolicySchema(category, mailboxKind(input.applicantEmail)).safeParse({
    applicantEmail: input.applicantEmail,
    organizationName: input.organizationName ?? undefined,
  });
  if (!applicantPolicy.success)
    throw new AppError(422, "VALIDATION_ERROR", "Check the category requirements", applicantPolicy.error.flatten());
  const form = await getGlobalFormByKey(db, MEMBERSHIP_APPLICATION_FORM_KEY);
  if (!form) {
    throw new AppError(503, "APPLICATION_FORM_UNAVAILABLE", "The membership application form is unavailable");
  }
  requireMembershipApplicationPolicyFields(form.fields);

  form.fields = membershipApplicationFields(form.fields, {
    isIndividual,
    eligibleWorkingGroupIds: await eligibleApplicationWorkingGroupIds(db, category.code),
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
  await refuseConflictingApplication(db, {
    isIndividual,
    organizationName: isIndividual ? null : (input.organizationName ?? null),
    organizationId: isIndividual ? null : (input.organizationId ?? null),
    applicantUserId: input.applicantUserId,
    applicantEmail: input.applicantEmail,
  });
  // An organization application holds the domain its address links through (normally the registrable domain).
  const organizationDomain = isIndividual ? null : await organizationLinkDomain(db, input.applicantEmail);
  const statusUrl = `${input.appBaseUrl}/application-status/?id=${encodeURIComponent(id)}&token=${encodeURIComponent(manageToken)}`;

  const applicantAccount = await prepareApplicantAccount(db, input);
  const applicantUserId = input.applicantUserId ?? applicantAccount?.user.id ?? null;
  const statements: StatementLike[] = [
    ...(applicantAccount?.statements ?? []),
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
    ...(input.applicantIdentityId && input.applicantUserId
      ? [
          prepareAuthorizationGuard(db, {
            sql: `SELECT 1 FROM identities
                   WHERE id = ? AND user_id = ? AND organization_id IS ?
                     AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL`,
            bindings: [input.applicantIdentityId, input.applicantUserId, input.organizationId ?? null],
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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?)`,
      )
      .bind(
        id,
        applicantUserId,
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

  statements.push(...prepareMembershipWorkflowPin(db, id, category, workflow, 1, now));

  if (organizationDomain) {
    statements.push(prepareClaimDomainForApplication(db, organizationDomain, id, now));
  }

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
      {
        applicantEmail: input.applicantEmail,
        membershipCategory: input.membershipCategory,
        ...(applicantAccount ? { accountCreated: true, userId: applicantAccount.user.id } : {}),
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
        "MEMBER_JOIN_CONTEXT_CHANGED",
        "Your verified identity or the category policy changed. Reload the application form and retry.",
      );
    }
    return translateDomainClaimConflict(db, organizationDomain, id, error);
  }

  return { id, manageToken, stage: "submitted", outboxId: confirmation.id };
}
