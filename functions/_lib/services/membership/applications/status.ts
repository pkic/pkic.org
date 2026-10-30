import { memberApplicationStatusResponseSchema } from "../../../../../assets/shared/schemas/member-applications";
import { first } from "../../../db/queries";
import { AppError } from "../../../errors";
import type { DatabaseLike } from "../../../types";
import { getMembershipWorkflowProgress } from "../workflows/progress";
import { verifyApplicationStatusToken } from "./queries";

export async function getApplicantStatus(
  db: DatabaseLike,
  applicationId: string,
  token: string,
  signingSecret?: string,
) {
  const application = await verifyApplicationStatusToken(db, applicationId, token, signingSecret);
  if (!application) throw new AppError(401, "AUTH_INVALID", "Invalid application id or token");
  const context = await first<{ version_id: string | null; category_label: string | null }>(
    db,
    `SELECT
       (SELECT version_id FROM membership_application_workflows
         WHERE application_id = ? AND superseded_at IS NULL) AS version_id,
       (SELECT label FROM membership_categories WHERE code = ?) AS category_label`,
    [applicationId, application.membership_category],
  );
  return memberApplicationStatusResponseSchema.parse({
    id: application.id,
    stage: application.stage,
    membershipCategory: application.membership_category,
    membershipCategoryLabel: context?.category_label ?? null,
    stageEnteredAt: application.stage_entered_at,
    createdAt: application.created_at,
    workflow: context?.version_id ? await getMembershipWorkflowProgress(db, applicationId) : null,
  });
}
