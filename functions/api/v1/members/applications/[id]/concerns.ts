/**
 * POST /api/v1/members/applications/:id/concerns.
 *
 * Member-session gated (not token-gated like status/documents —
 * requires the submitter to be an authenticated voting-category member, not the
 * applicant). Visible only to staff/processors afterward; never surfaced to
 * the applicant.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { submitApplicationConcern } from "../../../../../_lib/services/membership/applications/queries";
import { applicationConcernCreateRouteSchema } from "../../../../../../assets/shared/schemas/member-applications";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const MembersApplicationsConcernsPost = openApiRoute(
  applicationConcernCreateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);

    const body = data.body;
    const applicationId = c.req.param("id");
    const concern = await submitApplicationConcern(db, {
      applicationId,
      submittedByUserId: member.userId,
      submittedByMemberId: member.memberId,
      concernText: body.concernText,
    });

    return json({ id: concern.id, createdAt: concern.created_at }, 201);
  },
);
