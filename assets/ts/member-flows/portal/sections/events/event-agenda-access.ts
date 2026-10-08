import { portalSession } from "../../state";
/** Reflect exact contextual grants for controls; the API remains authoritative. */
export function hasEventAgendaPermission(eventId: string, permission: string, sponsorId?: string): boolean {
  const staff = portalSession.value?.staff;
  return (
    staff?.grants.some(
      (grant) =>
        grant.permission === permission &&
        (sponsorId
          ? grant.contextType === "event_sponsor" && grant.contextId === sponsorId
          : (grant.contextType === null && grant.contextId === null) ||
            (grant.contextType === "event" && grant.contextId === eventId)),
    ) ?? false
  );
}
