import { requireMeetingGuestFromRequest } from "../../../../../../_lib/auth/meeting-guest-session";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { AppError } from "../../../../../../_lib/errors";
import { createAuthenticatedMeetingJoinRoutes } from "../../../../meeting-entry-routes";

async function requireOccurrenceGuest(c: AdminContext, occurrenceId: string) {
  const guest = await requireMeetingGuestFromRequest(requestDb(c), c.req.raw, c.env);
  if (guest.verifiedOccurrenceId !== occurrenceId) {
    throw new AppError(403, "MEETING_GUEST_OCCURRENCE_FORBIDDEN", "Guest session is not valid for this occurrence");
  }
  return guest;
}

const routes = createAuthenticatedMeetingJoinRoutes(async (c, occurrenceId) => {
  const guest = await requireOccurrenceGuest(c, occurrenceId);
  return { kind: "guest", guestId: guest.guestId, sessionId: guest.sessionId };
});

export const GuestMeetingJoinLanding = routes.landing;
export const GuestMeetingJoinConfirm = routes.confirmation;
