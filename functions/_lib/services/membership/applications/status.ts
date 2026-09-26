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
  const pinned = await first(
    db,
    "SELECT version_id FROM membership_application_workflows WHERE application_id = ? AND superseded_at IS NULL",
    [applicationId],
  );
  return memberApplicationStatusResponseSchema.parse({
    id: application.id,
    stage: application.stage,
    stageEnteredAt: application.stage_entered_at,
    createdAt: application.created_at,
    workflow: pinned ? await getMembershipWorkflowProgress(db, applicationId) : null,
  });
}
