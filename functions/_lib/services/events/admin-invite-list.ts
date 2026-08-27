import type { AdminEventSpeakerInvitesListQuery } from "../../../../assets/shared/schemas/event-invites";
import type { DatabaseLike } from "../../types";
import { listEventInvitesOfType } from "./event-invite-list";

/**
 * Transitional admin adapter for the speaker workflow. The attendee workflow
 * is selected-group scoped; keeping this fixed server-side prevents the old
 * admin surface from becoming an attendee data-management backdoor.
 */
export async function listAdminEventSpeakerInvites(
  db: DatabaseLike,
  eventId: string,
  query: AdminEventSpeakerInvitesListQuery,
) {
  return listEventInvitesOfType(db, eventId, "speaker", query);
}
