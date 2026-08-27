/**
 * Staff listing/detail queries for member_applications. This management view
 * needs every stage
 * (not just active ones) plus the staff-only communications/notes/
 * concerns/EC-decision timelines the applicant-facing status endpoint never
 * returns.
 */
import { all, first } from "../../../db/queries";
import { queryPage } from "../../../db/pagination";
import { buildD1TextSearchFilter } from "../../../db/search";
import { AppError } from "../../../errors";
import { uuid } from "../../../utils/ids";
import { nowIso } from "../../../utils/time";
import { emailDomain, INDIVIDUAL_MEMBERSHIP_CATEGORIES, MEMBERSHIP_APPLICATION_FORM_KEY } from "./create";
import {
  getApplicationAnswers,
  getMemberApplicationById,
  listApplicationCommunications,
  listApplicationConcerns,
  type MemberApplicationRow,
} from "./queries";
import {
  getGlobalFormByKey,
  formSubmissionContextChangedError,
  isFormSubmissionContextConflict,
  prepareCreateFormSubmission,
  prepareUpdateFormSubmission,
  validateCustomAnswersAgainstForm,
} from "../../forms";
import { isAuditOneChangeGuardFailure, prepareAuditLogAfterOneChange } from "../../audit";
import {
  getOrganizationDomainClaim,
  prepareClaimDomainForApplication,
  prepareReleaseApplicationDomainClaim,
} from "../organization-domain-claims";
import { listEcDecisions } from "../../ec-review";
import {
  MEMBERSHIP_APPLICATIONS_SORT_COLUMNS,
  membershipApplicationDetailSchema,
  membershipApplicationSummarySchema,
  type MembershipApplicationsListQuery,
  type MembershipApplicationDetail,
  type MembershipApplicationSummary,
} from "../../../../../assets/shared/schemas/membership-application-management";
import { resolveMappedOrderBy } from "../../../db/sort";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../../types";

const MEMBERSHIP_APPLICATION_ORDER_COLUMNS: Record<(typeof MEMBERSHIP_APPLICATIONS_SORT_COLUMNS)[number], string> = {
  applicant_name: "ma.applicant_name",
  organization_name: "ma.organization_name",
  membership_category: "ma.membership_category",
  stage: "ma.stage",
  created_at: "ma.created_at",
};

type MembershipApplicationSummaryRow = Pick<
  MemberApplicationRow,
  | "id"
  | "applicant_email"
  | "applicant_name"
  | "organization_name"
  | "membership_category"
  | "stage"
  | "on_hold_subtype"
  | "assigned_to_user_id"
  | "created_at"
  | "updated_at"
>;

type MembershipApplicationManagementSummaryRow = MembershipApplicationSummaryRow & {
  membership_category_label: string;
};

function toSummary(
  row: MembershipApplicationSummaryRow,
  membershipCategoryLabel: string,
): MembershipApplicationSummary {
  return membershipApplicationSummarySchema.parse({
    id: row.id,
    applicantEmail: row.applicant_email,
    applicantName: row.applicant_name,
    organizationName: row.organization_name,
    membershipCategory: row.membership_category,
    membershipCategoryLabel,
    stage: row.stage,
    onHoldSubtype: row.on_hold_subtype,
    assignedToUserId: row.assigned_to_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function listMembershipApplications(
  db: DatabaseLike,
  params: MembershipApplicationsListQuery,
): Promise<{ applications: MembershipApplicationSummary[]; total: number }> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (params.stage) {
    conditions.push("ma.stage = ?");
    values.push(params.stage);
  }
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, [
      "ma.applicant_name",
      "ma.applicant_email",
      "ma.organization_name",
      "ma.membership_category",
      "mc.label",
      "ma.applicant_name || ' ' || ma.applicant_email || ' ' || COALESCE(ma.organization_name, '') || ' ' || ma.membership_category || ' ' || mc.label",
    ]);
    conditions.push(search.sql);
    values.push(...search.bindings);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = resolveMappedOrderBy(
    params.sort,
    MEMBERSHIP_APPLICATION_ORDER_COLUMNS,
    "ma.created_at DESC",
    "ma.id ASC",
  );

  const { rows, total } = await queryPage<MembershipApplicationManagementSummaryRow>(db, {
    sql: `SELECT ma.id, ma.applicant_email, ma.applicant_name, ma.organization_name,
                   ma.membership_category, mc.label AS membership_category_label,
                   ma.stage, ma.on_hold_subtype, ma.assigned_to_user_id,
                   ma.created_at, ma.updated_at
            FROM member_applications ma
            JOIN membership_categories mc ON mc.code = ma.membership_category ${where}`,
    bindings: values,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });

  return {
    applications: rows.map((row) => toSummary(row, row.membership_category_label)),
    total,
  };
}

interface ApplicationEventRow {
  from_stage: string | null;
  to_stage: string;
  actor_user_id: string | null;
  note: string | null;
  created_at: string;
}

export async function getMembershipApplicationDetail(
  db: DatabaseLike,
  applicationId: string,
): Promise<MembershipApplicationDetail> {
  const application = await getMemberApplicationById(db, applicationId);
  if (!application) {
    throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
  }

  const answers = await getApplicationAnswers(db, application.form_submission_id);
  const requestedWorkingGroups = answers.working_groups ?? answers.workingGroups;
  const requestedSlugs = Array.isArray(requestedWorkingGroups)
    ? [...new Set(requestedWorkingGroups.filter((value): value is string => typeof value === "string"))].slice(0, 200)
    : [];
  const [category, eventRows, communications, concerns, ecDecisions, requestedWorkingGroupRows] = await Promise.all([
    first<{ label: string }>(db, "SELECT label FROM membership_categories WHERE code = ?", [
      application.membership_category,
    ]),
    all<ApplicationEventRow>(
      db,
      `SELECT from_stage, to_stage, actor_user_id, note, created_at FROM member_application_events WHERE application_id = ? ORDER BY created_at ASC`,
      [applicationId],
    ),
    listApplicationCommunications(db, applicationId),
    listApplicationConcerns(db, applicationId),
    listEcDecisions(db, applicationId),
    requestedSlugs.length > 0
      ? all<{ slug: string; name: string }>(
          db,
          `SELECT slug, name
             FROM groups
            WHERE type_key = 'working_group'
              AND slug IN (SELECT value FROM json_each(?))`,
          [JSON.stringify(requestedSlugs)],
        )
      : Promise.resolve([]),
  ]);
  const requestedWorkingGroupNames = new Map(requestedWorkingGroupRows.map((row) => [row.slug, row.name]));

  return membershipApplicationDetailSchema.parse({
    ...toSummary(application, category?.label ?? application.membership_category),
    stageEnteredAt: application.stage_entered_at,
    answers,
    requestedWorkingGroups: requestedSlugs.map((slug) => ({
      slug,
      name: requestedWorkingGroupNames.get(slug) ?? slug,
    })),
    events: eventRows.map((row) => ({
      fromStage: row.from_stage,
      toStage: row.to_stage,
      actorUserId: row.actor_user_id,
      note: row.note,
      createdAt: row.created_at,
    })),
    communications: communications.map((row) => ({
      id: row.id,
      applicationId: row.application_id,
      kind: row.kind,
      actorUserId: row.actor_user_id,
      subject: row.subject,
      body: row.body,
      templateKey: row.template_key,
      emailOutboxId: row.email_outbox_id,
      createdAt: row.created_at,
    })),
    concerns: concerns.map((row) => ({
      id: row.id,
      applicationId: row.application_id,
      submittedByUserId: row.submitted_by_user_id,
      concernText: row.concern_text,
      createdAt: row.created_at,
    })),
    ecDecisions: ecDecisions.map((row) => ({
      id: row.id,
      applicationId: row.application_id,
      ecMemberUserId: row.ec_member_user_id,
      decision: row.decision,
      reason: row.reason,
      createdAt: row.created_at,
    })),
  });
}

// ── Edit application fields ─────────────────────────────────────────────
//
// Corrects applicant-submitted data (e.g. a mistyped email domain) without
// moving the application through the stage machine — a distinct
// operation from transitionApplicationStage. Route layer
// (functions/api/v1/system/membership-applications/[id]/index.ts) writes the audit_log
// entry; this function only touches member_applications and records a
// member_application_events row so the correction shows up in the
// application's timeline. Per consolidated migration 0035's own note, member_application_events
// has no "kind" column to tag this as non-transition, so the marker event
// uses from_stage === to_stage (the application's current stage, unchanged)
// with a note explaining what changed — the timeline UI already renders
// `fromStage -> toStage`, so an identical pair reads as "nothing moved" while
// the note carries the actual detail, keeping it visually distinct from a
// real transition (which always has fromStage !== toStage).
const EDITABLE_ANSWER_KEYS = [
  "job_title",
  "linkedin",
  "organization_website",
  "about_yourself",
  "about_organization",
  "reason",
] as const;

export interface ApplicationEditInput {
  applicantName?: string;
  applicantEmail?: string;
  organizationName?: string | null;
  membershipCategory?: string;
  answers?: Partial<Record<(typeof EDITABLE_ANSWER_KEYS)[number], string | null>>;
}

export async function updateMembershipApplication(
  db: DatabaseLike,
  applicationId: string,
  actor: UserBackedAuthAdmin,
  input: ApplicationEditInput,
): Promise<MembershipApplicationDetail> {
  const application = await getMemberApplicationById(db, applicationId);
  if (!application) {
    throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
  }

  const now = nowIso();
  const changedFields: string[] = [];
  const setClauses: string[] = [];
  const values: unknown[] = [];
  // A new form submission is the only prerequisite that may precede the
  // application CAS: member_applications.form_submission_id has a foreign
  // key, so the parent row must exist before the guarded update can commit.
  const foreignKeyPrerequisites: StatementLike[] = [];
  const dependentStatements: StatementLike[] = [];

  if (input.applicantName !== undefined && input.applicantName !== application.applicant_name) {
    setClauses.push("applicant_name = ?");
    values.push(input.applicantName);
    changedFields.push("applicantName");
  }

  const nextMembershipCategory = input.membershipCategory ?? application.membership_category;
  const nextIsIndividual = INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(nextMembershipCategory);
  const nextOrganizationName = nextIsIndividual
    ? null
    : input.organizationName === undefined
      ? application.organization_name
      : input.organizationName;
  if (!nextIsIndividual && !nextOrganizationName) {
    throw new AppError(422, "ORGANIZATION_NAME_REQUIRED", "Organization name is required for this category");
  }
  if (input.membershipCategory !== undefined && input.membershipCategory !== application.membership_category) {
    setClauses.push("membership_category = ?");
    values.push(input.membershipCategory);
    changedFields.push("membershipCategory");
  }

  const nextApplicantEmail = input.applicantEmail ?? application.applicant_email;
  if (input.applicantEmail !== undefined && input.applicantEmail !== application.applicant_email) {
    setClauses.push("applicant_email = ?");
    values.push(input.applicantEmail);
    changedFields.push("applicantEmail");
  }

  // Keep the denormalized application snapshot and canonical claim registry
  // in lockstep. The delete + replacement insert joins the application
  // update below in one batch, so a conflicting domain rolls everything back.
  const nextOrganizationDomain = nextIsIndividual ? null : emailDomain(nextApplicantEmail);
  const organizationDomainChanged = nextOrganizationDomain !== application.organization_domain;
  if (organizationDomainChanged) {
    if (application.stage === "approved") {
      throw new AppError(
        409,
        "APPROVED_DOMAIN_IMMUTABLE",
        "Change the approved organization's domain through organization management",
      );
    }
    setClauses.push("organization_domain = ?");
    values.push(nextOrganizationDomain);
    if (application.stage !== "declined" && application.stage !== "withdrawn") {
      dependentStatements.push(prepareReleaseApplicationDomainClaim(db, application.id));
      if (nextOrganizationDomain) {
        dependentStatements.push(prepareClaimDomainForApplication(db, nextOrganizationDomain, application.id, now));
      }
    }
  }

  if (input.organizationName !== undefined && input.organizationName !== application.organization_name) {
    setClauses.push("organization_name = ?");
    values.push(nextOrganizationName);
    changedFields.push("organizationName");
  } else if (
    nextIsIndividual !== INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(application.membership_category) &&
    nextIsIndividual &&
    application.organization_name !== null
  ) {
    // Category flipped to an individual (org-less) category and the caller
    // didn't also clear organizationName — clear it so the record stays
    // consistent with createMemberApplication's own invariant (individual
    // categories never carry an organization_name).
    setClauses.push("organization_name = ?");
    values.push(null);
  }

  if (input.answers) {
    const currentAnswers = await getApplicationAnswers(db, application.form_submission_id);
    const mergedAnswers = { ...currentAnswers };
    for (const key of EDITABLE_ANSWER_KEYS) {
      if (input.answers[key] === undefined) continue;
      const nextValue = input.answers[key] ?? null;
      if (nextValue !== (currentAnswers[key] ?? null)) {
        changedFields.push(`answers.${key}`);
        if (nextValue === null || nextValue.trim().length === 0) delete mergedAnswers[key];
        else mergedAnswers[key] = nextValue;
      }
    }

    if (changedFields.some((field) => field.startsWith("answers."))) {
      const form = await getGlobalFormByKey(db, MEMBERSHIP_APPLICATION_FORM_KEY);
      if (!form) {
        throw new AppError(500, "APPLICATION_FORM_MISSING", "No active membership application form is configured");
      }
      const normalizedAnswers = await validateCustomAnswersAgainstForm(form, {
        customAnswers: mergedAnswers,
        errorStatus: 422,
      });
      let formSubmissionId = application.form_submission_id;
      if (!formSubmissionId) {
        const submission = prepareCreateFormSubmission(
          db,
          form,
          { submittedByUserId: null, contextType: "membership", contextRef: applicationId },
          normalizedAnswers,
          now,
        );
        formSubmissionId = submission.id;
        foreignKeyPrerequisites.push(...submission.statements);
        setClauses.push("form_submission_id = ?");
        values.push(formSubmissionId);
      } else {
        const answerMutations = Object.fromEntries(
          EDITABLE_ANSWER_KEYS.filter((key) => input.answers?.[key] !== undefined).map((key) => [
            key,
            normalizedAnswers[key],
          ]),
        );
        dependentStatements.push(...prepareUpdateFormSubmission(db, form, formSubmissionId, answerMutations, now));
      }
    }
  }

  if (changedFields.length === 0) {
    // Nothing actually changed (e.g. caller sent the same values back) — skip
    // the write and the timeline event entirely.
    return getMembershipApplicationDetail(db, applicationId);
  }

  setClauses.push("updated_at = ?");
  values.push(now);
  values.push(applicationId, application.transition_revision);

  try {
    await db.batch([
      ...foreignKeyPrerequisites,
      db
        .prepare(
          `UPDATE member_applications
           SET ${setClauses.join(", ")}, transition_revision = transition_revision + 1
           WHERE id = ? AND transition_revision = ?`,
        )
        .bind(...values),
      // Keep the shared one-change guard immediately after the CAS. A stale
      // revision aborts the complete batch before domain, answer, history, or
      // outbox fallout can commit; the same statement is the canonical audit
      // record, so this command does not invent another guard dialect.
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actor.id,
        "application_edited",
        "member_application",
        applicationId,
        input,
        now,
      ),
      db
        .prepare(
          `INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          uuid(),
          applicationId,
          application.stage,
          application.stage,
          actor.id,
          `Application details edited: ${changedFields.join(", ")}`,
          now,
        ),
      ...dependentStatements,
    ]);
  } catch (error) {
    if (isFormSubmissionContextConflict(error)) {
      throw formSubmissionContextChangedError();
    }
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "APPLICATION_CHANGED", "Application changed while this edit was being prepared");
    }
    if (organizationDomainChanged && nextOrganizationDomain) {
      const claim = await getOrganizationDomainClaim(db, nextOrganizationDomain);
      if (claim && claim.applicationId !== applicationId) {
        throw new AppError(409, "ORGANIZATION_DOMAIN_IN_USE", "This organization domain is already claimed");
      }
    }
    throw error;
  }

  return getMembershipApplicationDetail(db, applicationId);
}
