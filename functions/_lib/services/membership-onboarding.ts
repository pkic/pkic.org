/**
 * Post-approval onboarding orchestration. The sole path to
 * `member_applications.status = 'approved'` — transitionApplicationStage
 * (member-applications.ts) deliberately excludes 'approved' as a
 * destination so this full orchestration can't be bypassed by a bare
 * stage-transition call.
 *
 * Does not call queueEmail directly (no access to env/executionCtx here —
 * same DB-only/route-owns-email split every other service in this codebase
 * uses, see member-applications.ts's own header note). Returns everything
 * the caller needs to queue member-account-claim, application-approved-
 * welcome, and org-contact-assigned.
 *
 * ICS calendar attachments (welcome email) are resolved and
 * attached by the caller (approve.ts, membership-scheduled-jobs.ts's
 * runEcWindowAutoApprove), not here — see meeting-calendar.ts's
 * resolveApprovalIcsAttachments, called with this function's own
 * workingGroupSlugs result. Same DB-only/route-owns-email split as the rest
 * of this file.
 */
import { first } from "../db/queries";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { AppError } from "../errors";
import {
  getApplicationAnswers,
  getMemberApplicationById,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
} from "./member-applications";
import { provisionOrganizationAndMembers } from "./member-provisioning";
import { enqueueGoogleGroupsSync } from "./google-groups";
import { resolveAutoSyncListEmails } from "./mailing-lists";
import type { DatabaseLike } from "../types";

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
  // form_submission_answers rows — see member-applications.ts's
  // getApplicationAnswers) but this call site previously only forwarded
  // name/email into provisionOrganizationAndMembers — even though that
  // function (and findOrCreateUser under it) already know how to persist
  // both. That silently dropped every approved applicant's job title and
  // LinkedIn URL. Read them back out here so they land on the newly
  // provisioned user.
  const answers = await getApplicationAnswers(db, application.form_submission_id);
  const requestedWorkingGroupSlugs = applicationWorkingGroupSlugs(answers);
  // CA WG constraint: only category A may be added to ca@.
  const workingGroupSlugs = requestedWorkingGroupSlugs.filter(
    (slug) => slug !== CA_WORKING_GROUP_SLUG || application.membership_category === CA_ONLY_CATEGORY,
  );
  const jobTitle = typeof answers.job_title === "string" && answers.job_title.trim() ? answers.job_title.trim() : null;
  const linkedin = typeof answers.linkedin === "string" && answers.linkedin.trim() ? answers.linkedin.trim() : null;

  const { organizationId, organizationWasCreated, members } = await provisionOrganizationAndMembers(db, {
    organizationName: isIndividual ? null : application.organization_name,
    organizationDomain: isIndividual ? null : application.organization_domain,
    membershipCategory: application.membership_category,
    representatives: [{ name: application.applicant_name, email: application.applicant_email, jobTitle, linkedin }],
    workingGroupSlugs,
  });
  const member = members[0];

  const now = nowIso();
  await db.batch([
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
  ]);

  // Google Groups enqueue (real API client is in google-groups.ts;
  // this only writes queue rows, safe to call regardless of whether the live
  // integration is configured). which lists to add depends on the
  // staff-managed mailing_lists config, not a hardcoded constant/category
  // check — resolveAutoSyncListEmails reads it at runtime. (This happens to
  // still resolve to "pkic@ always, consultation@ only for A-G" out of the
  // box, since that's how migration 0041 seeded auto_sync_categories_json —
  // but it's now data, not code.)
  const autoSyncListEmails = await resolveAutoSyncListEmails(db, application.membership_category);
  for (const googleGroupEmail of autoSyncListEmails) {
    await enqueueGoogleGroupsSync(db, { userId: member.userId, googleGroupEmail, action: "add_to_list" });
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
      await enqueueGoogleGroupsSync(db, {
        userId: member.userId,
        googleGroupEmail: wg.mailing_list_email,
        action: "add_to_list",
      });
    }
  }

  return {
    applicationId: application.id,
    organizationId,
    organizationWasCreated,
    memberId: member.memberId,
    userId: member.userId,
    email: member.email,
    name: member.name,
    isIndividual,
    workingGroupSlugs,
    workingGroupNames,
    assignedContactRole: member.assignedContactRole,
  };
}
