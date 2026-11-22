/** The event's ticket configuration resource; its prices, tickets, codes and settings are nested under it. */
export function ticketsEndpoint(slug: string): string {
  return `/api/v1/events/${encodeURIComponent(slug)}/tickets`;
}
