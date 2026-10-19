export function eventParticipantRecordPath(slug: string, kind: "registration" | "proposal", id: string) {
  return `/events/${encodeURIComponent(slug)}/${kind === "registration" ? "registrations" : "proposals"}/${encodeURIComponent(id)}`;
}

/** The event app's check-in page: the camera, or with a scanned code its confirmation. */
export function eventCheckInPath(slug: string, token?: string) {
  return `/events/${encodeURIComponent(slug)}/check-in${token ? `/${token}` : ""}`;
}
