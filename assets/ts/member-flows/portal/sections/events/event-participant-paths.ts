export function eventParticipantRecordPath(slug: string, kind: "registration" | "proposal", id: string) {
  return `/events/${encodeURIComponent(slug)}/${kind === "registration" ? "registrations" : "proposals"}/${encodeURIComponent(id)}`;
}
