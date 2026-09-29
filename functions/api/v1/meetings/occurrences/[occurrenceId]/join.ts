import { resolveMeetingJoinSubjectFromRequest } from "../../../../../_lib/auth/meeting-join-subject";
import { requestDb } from "../../../../../_lib/db/context";
import { createAuthenticatedMeetingJoinRoutes } from "../../../meeting-entry-routes";

const routes = createAuthenticatedMeetingJoinRoutes((c, occurrenceId) =>
  resolveMeetingJoinSubjectFromRequest(requestDb(c), c.req.raw, occurrenceId, c.env),
);

export const MeetingJoinLanding = routes.landing;
export const MeetingJoinConfirm = routes.confirmation;
