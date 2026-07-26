/**
 * GET /api/v1/members/applications/:id/status?token=...
 *
 * Token-gated applicant status check (PRD §1.2). The token is the plaintext
 * manageToken returned once from POST /api/v1/members/applications and
 * emailed in the application-received confirmation.
 */
import { OpenAPIRoute } from "chanfana";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { verifyApplicationManageToken } from "../../../../../_lib/services/member-applications";
import { memberApplicationStatusRouteSchema } from "../../../../../../assets/shared/schemas/member-applications";

export async function onRequestGet(c: any): Promise<Response> {
  c.set("sensitive", true);
  const db = c.env.DB;
  const applicationId = c.req.param("id");
  const token = new URL(c.req.raw.url).searchParams.get("token");

  if (!token) {
    throw new AppError(401, "AUTH_INVALID", "Missing token");
  }

  const application = await verifyApplicationManageToken(db, applicationId, token);
  if (!application) {
    throw new AppError(401, "AUTH_INVALID", "Invalid application id or token");
  }

  return json({
    id: application.id,
    status: application.status,
    stage: application.stage,
    stageEnteredAt: application.stage_entered_at,
    createdAt: application.created_at,
  });
}

export class MembersApplicationsStatusGet extends OpenAPIRoute {
  schema = memberApplicationStatusRouteSchema;

  async handle(c: any) {
    return onRequestGet(c);
  }
}
