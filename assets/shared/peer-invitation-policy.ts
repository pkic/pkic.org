/** Confirmed attendees may send peer invitations only before the event starts. */
export function canSendPeerInvitations(
  registrationStatus: string | null | undefined,
  startsAt: string | null | undefined,
  now = Date.now(),
): boolean {
  return registrationStatus === "registered" && typeof startsAt === "string" && Date.parse(startsAt) > now;
}
