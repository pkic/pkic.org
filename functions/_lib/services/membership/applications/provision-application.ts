import { nowIso } from "../../../utils/time";
import { uuid } from "../../../utils/ids";
import { AppError } from "../../../errors";
import { getApplicationAnswers, type MemberApplicationRow } from "./queries";
import { requireMembershipCategory } from "../categories";
import { buildProvisionOrganizationMembership } from "../provisioning";
import { prepareQueueEmailStatement } from "../../../email/outbox";
import { adminDatabaseUserId } from "../../../auth/admin-identity";
import { prepareAuditLog } from "../../audit";
import {
  buildMemberAccountClaimEmail,
  buildApplicationApprovedWelcomeEmail,
  buildOrgContactAssignedEmail,
} from "../notifications";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../../types";

export interface ApproveApplicationResult {
  applicationId: string;
  organizationId: string | null;
  organizationWasCreated: boolean;
  memberId: string;
  userId: string;
  email: string;
  name: string;
  isIndividual: boolean;
  workingGroupSlugs: string[];
  workingGroupNames: string[];
  assignedContactRole: "primary" | "secondary" | null;
  /** IDs of email_outbox rows queued in the same batch as membership provisioning — pass each to `processOutboxByIdBackground` after this commits. */
  outboxIds: string[];
}

const MAX_APPLICATION_WORKING_GROUPS = 20;

function applicationWorkingGroupSlugs(answers: Record<string, unknown>): string[] {
  const raw = answers.working_groups ?? answers.workingGroups;
  if (!Array.isArray(raw)) return [];
  const slugs = [...new Set(raw.filter((value): value is string => typeof value === "string"))];
  if (slugs.length > MAX_APPLICATION_WORKING_GROUPS) {
    throw new AppError(
      422,
      "TOO_MANY_WORKING_GROUPS",
      `An application may request at most ${MAX_APPLICATION_WORKING_GROUPS} working groups`,
    );
  }
  return slugs;
}

export interface ApplicationApprovalParams {
  /** `null` is reserved for unattended system approval. */
  actor: AuthAdmin | null;
  eventNote?: string;
  loginUrl: string;
  /** Route caller sends this once a contact role is assigned; the unattended auto-approve job never did, unchanged. */
  sendOrgContactAssignedEmail?: boolean;
}

/** Build provisioning, approval history, and durable effects for a caller-owned atomic command. */
export async function buildApplicationApproval(
  db: DatabaseLike,
  application: MemberApplicationRow,
  params: ApplicationApprovalParams,
): Promise<{ statements: StatementLike[]; guardIndex: number; result: ApproveApplicationResult }> {
  const { isIndividual } = await requireMembershipCategory(db, application.membership_category);

  // The apply form collects job_title/linkedin/working_groups as free-form
  // answers (form_fields seeded in migration 0034, now stored as real
  // form_submission_answers rows — see queries.ts's getApplicationAnswers)
  // but this call site previously only forwarded name/email into
  // provisionOrganizationMembership — even though that function (and
  // findOrCreateUser under it) already know how to persist both. That
  // silently dropped every approved applicant's job title and LinkedIn URL.
  // Read them back out here so they land on the newly provisioned user.
  const answers = await getApplicationAnswers(db, application.form_submission_id);
  const requestedWorkingGroupSlugs = applicationWorkingGroupSlugs(answers);
  const jobTitle = typeof answers.job_title === "string" && answers.job_title.trim() ? answers.job_title.trim() : null;
  const links = typeof answers.linkedin === "string" && answers.linkedin.trim() ? [answers.linkedin.trim()] : [];
  const databaseActorUserId = params.actor ? adminDatabaseUserId(params.actor) : null;

  // Everything below is built (not executed) and committed exactly once
  // at the end of this function: the provisioning statements, the
  // application's stage transition + event, and every Google Groups sync
  // enqueue. Previously these landed in three-plus separate `db.batch()`
  // calls, so a failure after provisioning succeeded but before the stage
  // transition committed could leave a member/organization created for an
  // application still unapproved (PR #1 review blocker 4). All
  // reads needed to decide *what* to build (auto-sync list membership, WG
  // name/mailing-list lookups) still happen before any statement is
  // built, same as provisioning.ts's own pattern.
  const provisioning = await buildProvisionOrganizationMembership(db, {
    organizationName: isIndividual ? null : application.organization_name,
    organizationDomain: isIndividual ? null : application.organization_domain,
    domainClaimApplicationId: isIndividual ? null : application.id,
    membershipCategory: application.membership_category,
    identities: [{ name: application.applicant_name, email: application.applicant_email, jobTitle, links }],
    identitySource: "membership_approval",
    activateIdentities: true,
    workingGroupSlugs: requestedWorkingGroupSlugs,
    allowManagedGroupEnrollment: false,
    ineligibleGroupPolicy: "omit",
    grantedByUserId: databaseActorUserId,
  });
  // Pure/synchronous — safe to call before the batch below commits, since
  // every id and decision it reports was already resolved by a pre-batch
  // read while building `provisioning.statements`.
  const { organizationId, organizationWasCreated, identities, groups } = provisioning.buildResult();
  const member = identities[0];
  const workingGroupSlugs = groups.map((group) => group.slug);
  const workingGroupNames = groups.map((group) => group.name);

  const now = nowIso();
  const fromStage = application.stage;
  const statements: StatementLike[] = [...provisioning.statements];

  // Compare-and-set: only applies if the application is still in the observed lifecycle,
  // guarding against a stale read racing a concurrent decline/on-hold/
  // second-approval transition. D1 does not treat an UPDATE that affects
  // zero rows as a failed statement, so the immediately following history
  // insert deliberately violates the NOT NULL constraint on to_stage when
  // changes() is not 1. That makes every lost compare-and-set a real SQL
  // failure and rolls back this entire batch, including all provisioning,
  // outbox, sync-queue, and audit statements. The partial unique approved
  // event index remains a second structural defense for same-target races.
  const guardIndex = statements.length;
  statements.push(
    db
      .prepare(
        `UPDATE member_applications
         SET stage = 'approved', applicant_user_id = ?, member_id = ?, stage_entered_at = ?,
             transition_revision = transition_revision + 1,
             on_hold_reminder_sent_at = NULL, updated_at = ?
         WHERE id = ? AND stage = ? AND transition_revision = ?`,
      )
      .bind(member.userId, member.membershipId, now, now, application.id, fromStage, application.transition_revision),
    db
      .prepare(
        `INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, ?, CASE WHEN changes() = 1 THEN 'approved' ELSE NULL END, ?, ?, ?)`,
      )
      .bind(uuid(), application.id, fromStage, databaseActorUserId, params.eventNote ?? "Application approved", now),
  );

  // Every email below is queued (not sent — sending needs env/executionCtx,
  // which callers still own, see header comment), so the insert can commit
  // in the same batch as membership state above. Group meeting invitations
  // are driven by group-owned events, not uploaded ICS welcome attachments.
  const outboxIds: string[] = [];

  const claimEmail = prepareQueueEmailStatement(
    db,
    buildMemberAccountClaimEmail({ recipientEmail: member.email, memberName: member.name, loginUrl: params.loginUrl }),
    now,
  );
  statements.push(claimEmail.statement);
  outboxIds.push(claimEmail.id);

  const welcomeEmail = prepareQueueEmailStatement(
    db,
    buildApplicationApprovedWelcomeEmail({
      recipientEmail: member.email,
      applicantName: member.name,
      loginUrl: params.loginUrl,
      workingGroupNames,
    }),
    now,
  );
  statements.push(welcomeEmail.statement);
  outboxIds.push(welcomeEmail.id);

  if (params.sendOrgContactAssignedEmail && member.assignedContactRole) {
    const contactEmail = prepareQueueEmailStatement(
      db,
      buildOrgContactAssignedEmail({
        recipientEmail: member.email,
        memberName: member.name,
        contactRole: member.assignedContactRole,
      }),
      now,
    );
    statements.push(contactEmail.statement);
    outboxIds.push(contactEmail.id);
  }

  {
    statements.push(
      prepareAuditLog(
        db,
        params.actor ? "user" : "system",
        params.actor?.id ?? null,
        "application_approved",
        "member_application",
        application.id,
        { memberId: member.membershipId, organizationId },
        now,
      ),
    );
  }

  return {
    statements,
    guardIndex,
    result: {
      applicationId: application.id,
      organizationId,
      organizationWasCreated,
      memberId: member.membershipId,
      userId: member.userId,
      email: member.email,
      name: member.name,
      isIndividual,
      workingGroupSlugs,
      workingGroupNames,
      assignedContactRole: member.assignedContactRole,
      outboxIds,
    },
  };
}
