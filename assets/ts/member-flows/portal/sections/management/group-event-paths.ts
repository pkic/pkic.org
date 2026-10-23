/** Canonical routed subresources, independent of loading their editing screens. */
export const NEW_CAMPAIGN_SEGMENT = "new";
export const CALL_SEGMENT = "call";

export function groupEventProposalPath(groupId: string, eventId: string, proposalId: string): string {
  return `/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/proposals/${encodeURIComponent(proposalId)}`;
}
