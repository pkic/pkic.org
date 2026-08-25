import { requireMemberFromRequest } from "../../../../../../_lib/auth/member";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { AppError } from "../../../../../../_lib/errors";
import { createAuthenticatedMeetingJoinRoutes } from "../../../../meeting-entry-routes";

const routes = createAuthenticatedMeetingJoinRoutes(async (c: AdminContext) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  if (!member.sessionId) throw new AppError(401, "AUTH_INVALID", "Member session is unavailable");
  return { kind: "member", userId: member.userId, sessionId: member.sessionId };
});

export const MemberMeetingJoinLanding = routes.landing;
export const MemberMeetingJoinConfirm = routes.confirmation;
