/**
 * Post-approval onboarding orchestration. The sole path to
 * `member_applications.status = 'approved'` — transitionApplicationStage
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
 * application's stage transition + event insert, and every Google Groups
 * sync-queue enqueue all commit in exactly one `db.batch()` at the end of
 * this function — not three-plus separate commits, so a failure anywhere
 * in the sequence can never leave a member/organization provisioned for
 * an application that's still stuck in `ec_review` (PR #1 review
 * blocker 4).
 *
 * Does not call queueEmail directly (no access to env/executionCtx here —
 * same DB-only/route-owns-email split every other service in this codebase
 * uses, see queries.ts's own header note). Returns everything the caller
 * needs to queue member-account-claim, application-approved-welcome, and
 * org-contact-assigned — those email-outbox writes and the audit-log
 * write happen in the HTTP route after this commits, deliberately outside
 * this atomic boundary: they're secondary effects with their own
 * idempotent-retry machinery (the outbox), not membership state that
 * needs all-or-nothing commit semantics.
 *
 * ICS calendar attachments (welcome email) are resolved and
 * attached by the caller (functions/api/v1/admin/applications/[id]/approve.ts,
 * scheduled-jobs.ts's runEcWindowAutoApprove), not here — see
 * meeting-calendar.ts's resolveApprovalIcsAttachments, called with this
 * function's own workingGroupSlugs result. Same DB-only/route-owns-email
 * split as the rest of this file.
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
import type { DatabaseLike, StatementLike } from "../../../types";

const CA_WORKING_GROUP_SLUG = "ca";
const CA_ONLY_CATEGORY = "A";

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
}

function applicationWorkingGroupSlugs(answers: Record<string, unknown>): string[] {
  const raw = answers.working_groups ?? answers.workingGroups;
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === "string");
}

export async function approveApplication(
  db: DatabaseLike,
  params: { applicationId: string; actorUserId: string | null; eventNote?: string },
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
  const linkedin = typeof answers.linkedin === "string" && answers.linkedin.trim() ? answers.linkedin.trim() : null;

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
    membershipCategory: application.membership_category,
    representatives: [{ name: application.applicant_name, email: application.applicant_email, jobTitle, linkedin }],
    workingGroupSlugs,
  });
  // Pure/synchronous — safe to call before the batch below commits, since
  // every id and decision it reports was already resolved by a pre-batch
  // read while building `provisioning.statements`.
  const { organizationId, organizationWasCreated, representatives } = provisioning.buildResult();
  const member = representatives[0];

  const now = nowIso();
  const statements: StatementLike[] = [...provisioning.statements];

  statements.push(
    db
      .prepare(
        `UPDATE member_applications SET status = 'approved', stage = 'approved', stage_entered_at = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(now, now, application.id),
    db
      .prepare(
        `INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, ?, 'approved', ?, ?, ?)`,
      )
      .bind(
        uuid(),
        application.id,
        application.stage,
        params.actorUserId,
        params.eventNote ?? "Application approved",
        now,
      ),
  );

  // Google Groups enqueue (real API client is in google-groups.ts; this
  // only writes queue rows, safe regardless of whether the live
  // integration is configured). Which lists to add depends on the
  // staff-managed mailing_lists config, not a hardcoded constant/category
  // check — resolveAutoSyncListEmails reads it at runtime. (This happens to
  // still resolve to "pkic@ always, consultation@ only for A-G" out of the
  // box, since that's how migration 0041 seeded auto_sync_categories_json —
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

  await db.batch(statements);

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
  };
}
