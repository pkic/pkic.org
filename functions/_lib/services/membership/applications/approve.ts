/**
 * Post-approval onboarding orchestration. The sole path to
 * `member_applications.stage = 'approved'` — transitionApplicationStage
 * (transition.ts) deliberately excludes 'approved' as a destination so this
 * full orchestration can't be bypassed by a bare stage-transition call.
 *
 * Merges the former membership-onboarding.ts (orchestration) and
 * member-provisioning.ts (its one caller of the canonical
 * provisionOrganizationMembership use case) into one file (PR #1 review
 * §1.5) — the two were only ever used together.
 *
 * Atomicity: provisioning (organization/aggregate/representative/role
 * statements from provisioning.ts's build-only entry point), the
 * application's stage transition + event insert, every Google Groups
 * sync-queue enqueue, the member-account-claim/application-approved-welcome/
 * org-contact-assigned email-outbox inserts, and the audit-log insert all
 * commit in exactly one `db.batch()` at the end of this function — not
 * three-plus separate commits, so a failure anywhere in the sequence can
 * never leave a member/organization provisioned (or a claim email queued)
 * for an application that's still stuck in `ec_review`, and can never
 * leave membership state committed with no durable record either at all
 * (PR #1 review phase1-2-review-20260817.md blocker 4: "durable external
 * effects should enter the outbox in that same boundary").
 *
 * `loginUrl` is a plain string, not `env`/`config` — building the email
 * *content* (subject/body data) needs no D1 or Worker binding access, only
 * the base URL, which callers already resolve from their own `env` before
 * calling in (see the two callers: admin/applications/[id]/approve.ts and
 * scheduled-jobs.ts's runEcWindowAutoApprove). Actually *sending* still
 * happens after this returns: the interactive admin route sends
 * immediately via `c.executionCtx.waitUntil(processOutboxByIdBackground(...))`
 * over the returned `outboxIds`; the unattended EC-window auto-approve job
 * (potentially many approvals per pass) deliberately does not — it leaves
 * the rows `queued` for the shared bounded outbox processor to pick up, so
 * one job never fans out into N synchronous per-recipient sends within the
 * scheduled-job budget (PR #1 review §9.1). Either way, this module needs
 * no `env`/`executionCtx` of its own: the outbox's own idempotent-retry
 * machinery covers delivery, only the *queueing* needed to be atomic with
 * membership state.
 *
 * The audit-log insert is folded in only when an admin `actor` is set (the
 * interactive admin route always sets it; the unattended EC-window
 * auto-approve job passes `null` and intentionally writes no audit entry,
 * unchanged from its prior behavior).
 *
 * Race-safety (PR #1 review §5 correction): the stage-transition UPDATE is
 * a compare-and-set (`WHERE stage = <the stage this call read>`), and the
 * event insert is conditioned on that UPDATE's own success rather than on
 * the row's post-write state (which a concurrent winner racing to the same
 * 'approved' target could also satisfy). `uq_member_application_events_approved`
 * (consolidated migration 0035) backstops this by rejecting a second concurrent
 * approval's event insert outright, failing that whole `db.batch()` so its
 * provisioning/notification/audit statements never commit either — see the
 * inline comments around the guard below for the full mechanism.
 */
import { first } from "../../../db/queries";
import { nowIso } from "../../../utils/time";
import { uuid } from "../../../utils/ids";
import { AppError } from "../../../errors";
import { getApplicationAnswers, getMemberApplicationById } from "./queries";
import { INDIVIDUAL_MEMBERSHIP_CATEGORIES } from "./create";
import { buildProvisionOrganizationMembership } from "../provisioning";
import { buildEnqueueGoogleGroupsSyncStatement } from "../../google-groups";
import { resolveAutoSyncListEmails } from "../../mailing-lists";
import { prepareQueueEmailStatement } from "../../../email/outbox";
import { adminDatabaseUserId } from "../../../auth/admin-identity";
import { prepareAuditLog } from "../../audit";
import { resolveApprovalIcsAttachments } from "../../meeting-calendar";
import {
  buildMemberAccountClaimEmail,
  buildApplicationApprovedWelcomeEmail,
  buildOrgContactAssignedEmail,
} from "../notifications";
import { CA_WORKING_GROUP_SLUG, CA_ONLY_CATEGORY } from "../../working-groups";
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

/** Staff may resolve an EC decline explicitly; unattended approval may never override one. */
export type ApplicationApprovalMode = "staff_override" | "automatic_no_ec_objection";

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

export async function approveApplication(
  db: DatabaseLike,
  params: {
    applicationId: string;
    /** `null` is reserved for unattended system approval. */
    actor: AuthAdmin | null;
    approvalMode: ApplicationApprovalMode;
    eventNote?: string;
    loginUrl: string;
    /** Route caller sends this once a contact role is assigned; the unattended auto-approve job never did, unchanged. */
    sendOrgContactAssignedEmail?: boolean;
  },
): Promise<ApproveApplicationResult> {
  const application = await getMemberApplicationById(db, params.applicationId);
  if (!application) {
    throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
  }
  if (application.stage !== "ec_review") {
    throw new AppError(409, "APPLICATION_NOT_READY_FOR_APPROVAL", "Application must be in ec_review to approve");
  }

  const isIndividual = INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(application.membership_category);

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
  // CA WG constraint: only category A may be added to ca@.
  const workingGroupSlugs = requestedWorkingGroupSlugs.filter(
    (slug) => slug !== CA_WORKING_GROUP_SLUG || application.membership_category === CA_ONLY_CATEGORY,
  );
  const jobTitle = typeof answers.job_title === "string" && answers.job_title.trim() ? answers.job_title.trim() : null;
  const links = typeof answers.linkedin === "string" && answers.linkedin.trim() ? [answers.linkedin.trim()] : [];
  const databaseActorUserId = params.actor ? adminDatabaseUserId(params.actor) : null;

  // Everything below is built (not executed) and committed exactly once
  // at the end of this function: the provisioning statements, the
  // application's stage transition + event, and every Google Groups sync
  // enqueue. Previously these landed in three-plus separate `db.batch()`
  // calls, so a failure after provisioning succeeded but before the stage
  // transition committed could leave a member/organization created for an
  // application still stuck in `ec_review` (PR #1 review blocker 4). All
  // reads needed to decide *what* to build (auto-sync list membership, WG
  // name/mailing-list lookups) still happen before any statement is
  // built, same as provisioning.ts's own pattern.
  const provisioning = await buildProvisionOrganizationMembership(db, {
    organizationName: isIndividual ? null : application.organization_name,
    organizationDomain: isIndividual ? null : application.organization_domain,
    domainClaimApplicationId: isIndividual ? null : application.id,
    membershipCategory: application.membership_category,
    representatives: [{ name: application.applicant_name, email: application.applicant_email, jobTitle, links }],
    workingGroupSlugs,
    grantedByUserId: databaseActorUserId,
  });
  // Pure/synchronous — safe to call before the batch below commits, since
  // every id and decision it reports was already resolved by a pre-batch
  // read while building `provisioning.statements`.
  const { organizationId, organizationWasCreated, representatives } = provisioning.buildResult();
  const member = representatives[0];

  const now = nowIso();
  const fromStage = application.stage;
  const requireNoEcDecline = params.approvalMode === "automatic_no_ec_objection";
  const statements: StatementLike[] = [...provisioning.statements];

  // Compare-and-set: only applies if the application is still in ec_review,
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
         SET stage = 'approved', stage_entered_at = ?, transition_revision = transition_revision + 1,
             on_hold_reminder_sent_at = NULL, updated_at = ?
         WHERE id = ? AND stage = ? AND transition_revision = ?
           AND (? = 0 OR NOT EXISTS (
             SELECT 1 FROM ec_decisions
             WHERE application_id = member_applications.id AND decision = 'decline'
           ))`,
      )
      .bind(now, now, application.id, fromStage, application.transition_revision, requireNoEcDecline ? 1 : 0),
    db
      .prepare(
        `INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, ?, CASE WHEN changes() = 1 THEN 'approved' ELSE NULL END, ?, ?, ?)`,
      )
      .bind(uuid(), application.id, fromStage, databaseActorUserId, params.eventNote ?? "Application approved", now),
  );

  // Google Groups enqueue (real API client is in google-groups.ts; this
  // only writes queue rows, safe regardless of whether the live
  // integration is configured). Which lists to add depends on the
  // staff-managed mailing_lists config, not a hardcoded constant/category
  // check — resolveAutoSyncListEmails reads it at runtime. (This happens to
  // still resolve to "pkic@ always, consultation@ only for A-G" out of the
  // box, since that's how consolidated migration 0035 seeded auto_sync_categories_json —
  // but it's now data, not code.)
  const autoSyncListEmails = await resolveAutoSyncListEmails(db, application.membership_category);
  for (const googleGroupEmail of autoSyncListEmails) {
    const { statement } = buildEnqueueGoogleGroupsSyncStatement(db, {
      userId: member.userId,
      googleGroupEmail,
      action: "add_to_list",
    });
    statements.push(statement);
  }

  const workingGroupNames: string[] = [];
  for (const slug of workingGroupSlugs) {
    const wg = await first<{ name: string; mailing_list_email: string | null }>(
      db,
      "SELECT name, mailing_list_email FROM working_groups WHERE slug = ?",
      [slug],
    );
    if (!wg) continue;
    workingGroupNames.push(wg.name);
    if (wg.mailing_list_email) {
      const { statement } = buildEnqueueGoogleGroupsSyncStatement(db, {
        userId: member.userId,
        googleGroupEmail: wg.mailing_list_email,
        action: "add_to_list",
      });
      statements.push(statement);
    }
  }

  // Every email below is queued (not sent — sending needs env/executionCtx,
  // which callers still own, see header comment), so the insert can commit
  // in the same batch as membership state above. All reads it depends on
  // (icsAttachments) already happened.
  const icsAttachments = await resolveApprovalIcsAttachments(db, workingGroupSlugs);
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
      icsAttachments,
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

  if (params.actor) {
    statements.push(
      prepareAuditLog(
        db,
        "admin",
        params.actor.id,
        "application_approved",
        "member_application",
        application.id,
        { memberId: member.membershipId, organizationId },
        now,
      ),
    );
  }

  let results: Awaited<ReturnType<DatabaseLike["batch"]>>;
  try {
    results = await db.batch(statements);
  } catch (err) {
    // A lost compare-and-set fails through the event row's NOT NULL
    // constraint; a same-target approval race can also fail through the
    // partial unique index. Confirm the application actually moved before
    // translating either expected race to 409. Unrelated database failures
    // are rethrown unchanged.
    const current = await getMemberApplicationById(db, application.id);
    if (
      requireNoEcDecline &&
      err instanceof Error &&
      err.message.includes("NOT NULL constraint failed: member_application_events.to_stage")
    ) {
      const decline = await first<{ id: string }>(
        db,
        "SELECT id FROM ec_decisions WHERE application_id = ? AND decision = 'decline' LIMIT 1",
        [application.id],
      );
      if (decline) {
        throw new AppError(
          409,
          "APPLICATION_EC_DECLINED",
          "Application has an Executive Council decline and cannot be automatically approved",
        );
      }
    }
    if (current && (current.stage !== "ec_review" || current.transition_revision !== application.transition_revision)) {
      throw new AppError(
        409,
        "APPLICATION_ALREADY_APPROVED",
        "Application was already approved, edited, or moved to a different stage",
      );
    }
    throw err;
  }

  if ((results[guardIndex]?.meta?.changes ?? 0) === 0) {
    throw new AppError(
      409,
      "APPLICATION_ALREADY_APPROVED",
      `Application stage changed concurrently; expected '${fromStage}'`,
    );
  }

  return {
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
  };
}
