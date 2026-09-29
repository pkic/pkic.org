function segment(value: string): string {
  return encodeURIComponent(value);
}

export function eventProposalsViewPath(eventSlug: string): string {
  return `/events/${segment(eventSlug)}/proposals`;
}

export function eventProposalDetailViewPath(eventSlug: string, proposalId: string): string {
  return `${eventProposalsViewPath(eventSlug)}/detail/${segment(proposalId)}`;
}
