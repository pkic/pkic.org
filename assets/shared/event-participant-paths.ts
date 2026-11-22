import { eventRegistrationRecordRoute } from "./event-participation-link";

export function eventParticipantRecordPath(slug: string, kind: "registration" | "proposal", id: string) {
  if (kind === "registration") return eventRegistrationRecordRoute(slug, id);
  return `/events/${encodeURIComponent(slug)}/proposals/${encodeURIComponent(id)}`;
}

/** The event app's check-in page: the camera, or with a scanned code its confirmation. */
export function eventCheckInPath(slug: string, token?: string) {
  return `/events/${encodeURIComponent(slug)}/check-in${token ? `/${token}` : ""}`;
}
