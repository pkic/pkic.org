export interface MeetingGuestInvitationFragment {
  token: string;
  occurrenceId: string;
}

export function parseMeetingGuestInvitationFragment(hash: string): MeetingGuestInvitationFragment | null {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  const queryStart = normalized.indexOf("?");
  if (queryStart < 0 || normalized.slice(0, queryStart).replace(/^\//, "") !== "verify") return null;
  const params = new URLSearchParams(normalized.slice(queryStart + 1));
  const token = params.get("token")?.trim();
  const occurrenceId = params.get("occurrence")?.trim();
  return token && occurrenceId ? { token, occurrenceId } : null;
}

export function consumeMeetingGuestInvitationFragment(
  location: Pick<Location, "hash" | "pathname">,
  history: Pick<History, "replaceState">,
): MeetingGuestInvitationFragment | null {
  const invitation = parseMeetingGuestInvitationFragment(location.hash);
  if (!invitation) return null;
  history.replaceState({}, "", `${location.pathname}?occurrence=${encodeURIComponent(invitation.occurrenceId)}`);
  return invitation;
}
