export function eventRegistrationPath(slug: string) {
  return `/events/${encodeURIComponent(slug)}/registration`;
}

export function eventProposalPath(slug: string, id: string) {
  return `/events/${encodeURIComponent(slug)}/proposals/${encodeURIComponent(id)}`;
}

/** The event app's check-in page: the camera, or with a scanned code its confirmation. */
export function eventCheckInPath(slug: string, token?: string) {
  return `/events/${encodeURIComponent(slug)}/check-in${token ? `/${token}` : ""}`;
}
