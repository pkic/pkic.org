import type { UserCatalogListQuery } from "../../../../../assets/shared/schemas/user-catalog";
import { listUserCatalog } from "../../user-catalog";
import { consensusReviewerEvidence } from "./reviewer-eligibility";
import type { z } from "zod";
import { membershipWorkflowReviewResponseSchema } from "../../../../../assets/shared/schemas/membership-review-routes";
import {
  membershipWorkflowObjectionsResponseSchema,
  type membershipWorkflowObjectionsQuerySchema,
} from "../../../../../assets/shared/schemas/membership-workflows";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import { hasPermission } from "../../../auth/permissions";
import { queryPage } from "../../../db/pagination";
import { first } from "../../../db/queries";
import { buildD1TextSearchFilter } from "../../../db/search";
import { resolveMappedOrderBy } from "../../../db/sort";
import { AppError } from "../../../errors";
import type { DatabaseLike } from "../../../types";
import { getApplicationAnswers, getRequestedApplicationGroups } from "../applications/queries";
import { getMembershipExecution } from "./execution";
import { membershipWorkflowProgress } from "./progress";
import { requireWorkflowReviewer, type MembershipReviewer } from "./reviewer-eligibility";

async function authorizedReview(db: DatabaseLike, applicationId: string, actor: MembershipReviewer) {
  const execution = await getMembershipExecution(db, applicationId);
  const step = execution.version.definition.steps[execution.currentPosition];
  let eligible = false;
  if (step && step.kind !== "payment") {
    try {
      await requireWorkflowReviewer(db, step, actor);
      eligible = true;
    } catch (error) {
      if (!(error instanceof AppError && error.status === 403)) throw error;
    }
  }
  const staffRead = Boolean(
    actor.staff && (hasPermission(actor.staff, "membership:read") || hasPermission(actor.staff, "membership:approve")),
  );
  if (
    !staffRead &&
    !eligible &&
    !(await first(
      db,
      "SELECT id FROM membership_application_objections WHERE application_id = ? AND author_user_id = ? LIMIT 1",
      [applicationId, actor.userId],
    ))
  )
    throw new AppError(403, "MEMBERSHIP_REVIEW_FORBIDDEN", "This application review is not available to your account.");
  return { execution, eligible, step };
}
export async function getMembershipReview(db: DatabaseLike, applicationId: string, actor: MembershipReviewer) {
  const { execution, eligible, step } = await authorizedReview(db, applicationId, actor);
  const application = execution.application;
  const open = !["approved", "declined", "withdrawn"].includes(application.stage);
  const answers = await getApplicationAnswers(db, application.form_submission_id);
  return membershipWorkflowReviewResponseSchema.parse({
    application: {
      id: application.id,
      applicantName: application.applicant_name,
      applicantEmail: application.applicant_email,
      organizationName: application.organization_name,
      membershipCategory: application.membership_category,
      answers,
      requestedWorkingGroups: await getRequestedApplicationGroups(db, answers),
    },
    workflow: membershipWorkflowProgress(execution),
    userId: actor.userId,
    capabilities: {
      completeReview: open && eligible && step?.kind === "staff_review" && application.stage !== "on_hold",
      object: open && eligible && step?.kind === "consensus",
      recordForReviewer:
        open && step?.kind === "consensus" && Boolean(actor.staff && hasPermission(actor.staff, "membership:approve")),
      resolveObjections: open && Boolean(actor.staff && hasPermission(actor.staff, "membership:approve")),
    },
  });
}
export async function listMembershipObjections(
  db: DatabaseLike,
  applicationId: string,
  actor: MembershipReviewer,
  query: z.infer<typeof membershipWorkflowObjectionsQuerySchema>,
) {
  await authorizedReview(db, applicationId, actor);
  const search = query.q ? buildD1TextSearchFilter(query.q, ["objection.body", "objection.resolution_reason"]) : null;
  const result = await queryPage(db, {
    sql: `SELECT objection.id, objection.step_position AS position, objection.author_user_id AS authorUserId, objection.recorded_by_user_id AS recordedByUserId,
    COALESCE(NULLIF(TRIM(COALESCE(author.first_name, '') || ' ' || COALESCE(author.last_name, '')), ''), author.email, 'Historic reviewer') AS authorLabel,
    COALESCE(NULLIF(TRIM(COALESCE(recorder.first_name, '') || ' ' || COALESCE(recorder.last_name, '')), ''), recorder.email) AS recordedByLabel,
    objection.body, objection.state, objection.resolution_reason AS resolutionReason, objection.resolved_by_user_id AS resolvedByUserId, objection.resolved_at AS resolvedAt, objection.created_at AS createdAt
    FROM membership_application_objections objection
    LEFT JOIN users author ON author.id = objection.author_user_id
    LEFT JOIN users recorder ON recorder.id = objection.recorded_by_user_id
    WHERE objection.application_id = ?${search ? ` AND ${search.sql}` : ""}`,
    bindings: [applicationId, ...(search?.bindings ?? [])],
    orderBy: resolveMappedOrderBy(
      query.sort,
      { createdAt: "objection.created_at", state: "objection.state" },
      "objection.created_at DESC",
      "objection.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return membershipWorkflowObjectionsResponseSchema.parse({
    objections: result.rows,
    page: buildPageInfo(query.limit, query.offset, result.total, result.rows.length),
  });
}

export async function listMembershipReviewers(
  db: DatabaseLike,
  applicationId: string,
  actor: MembershipReviewer,
  query: UserCatalogListQuery,
) {
  if (!actor.staff || !hasPermission(actor.staff, "membership:approve"))
    throw new AppError(
      403,
      "MEMBERSHIP_ATTRIBUTION_FORBIDDEN",
      "Recording responses for another reviewer requires membership approval permission.",
    );
  const { step } = await authorizedReview(db, applicationId, actor);
  if (step?.kind !== "consensus")
    throw new AppError(409, "MEMBERSHIP_CONSENSUS_NOT_ACTIVE", "No consensus review is active.");
  return listUserCatalog(db, query, consensusReviewerEvidence(step, "", "u.id"));
}
