/**
 * POST /api/v1/members/applications/:id/concerns.
 *
 * Member-session gated (not token-gated like status/documents —
 * requires the submitter to be an authenticated A-G member, not the
 * applicant). Visible only to staff/processors afterward; never surfaced to
 * the applicant.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { submitApplicationConcern } from "../../../../../_lib/services/membership/applications/queries";
import { VOTING_CATEGORIES } from "../../../../../_lib/services/membership/applications/create";
import { applicationConcernCreateRouteSchema } from "../../../../../../assets/shared/schemas/member-applications";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const MembersApplicationsConcernsPost = openApiRoute(
  applicationConcernCreateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    if (!VOTING_CATEGORIES.has(member.membershipCategory)) {
      throw new AppError(403, "PERMISSION_REQUIRED", "Only A-G category members may submit a consultation concern");
    }

    const body = data.body;
    const applicationId = c.req.param("id");
    const concern = await submitApplicationConcern(db, {
      applicationId,
      submittedByUserId: member.userId,
      concernText: body.concernText,
    });

    return json({ id: concern.id, createdAt: concern.created_at }, 201);
  },
);
