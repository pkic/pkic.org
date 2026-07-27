/**
 * POST /api/v1/members/applications/:id/concerns — PRD §4.5.
 *
 * Member-session gated (not token-gated like status/documents — the PRD
 * requires the submitter to be an authenticated A-G member, not the
 * applicant). Visible only to staff/processors afterward; never surfaced to
 * the applicant.
 */
import { OpenAPIRoute } from "chanfana";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { parseJsonBody } from "../../../../../_lib/validation";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { submitApplicationConcern, VOTING_CATEGORIES } from "../../../../../_lib/services/member-applications";
import {
  applicationConcernCreateRouteSchema,
  applicationConcernCreateSchema,
} from "../../../../../../assets/shared/schemas/member-applications";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  if (!VOTING_CATEGORIES.has(member.membershipCategory)) {
    throw new AppError(403, "PERMISSION_REQUIRED", "Only A-G category members may submit a consultation concern");
  }

  const body = await parseJsonBody(c.req, applicationConcernCreateSchema);
  const applicationId = c.req.param("id");
  const concern = await submitApplicationConcern(db, {
    applicationId,
    submittedByUserId: member.userId,
    concernText: body.concernText,
  });

  return json({ id: concern.id, createdAt: concern.created_at }, 201);
}

export class MembersApplicationsConcernsPost extends OpenAPIRoute {
  schema = applicationConcernCreateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
