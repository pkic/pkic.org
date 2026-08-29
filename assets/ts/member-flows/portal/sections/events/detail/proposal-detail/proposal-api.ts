/** Canonical proposal resource paths used by the admin detail adapter. */
export function proposalResourcePath(proposalId: string, resource = ""): string {
  const base = `/api/v1/proposals/${encodeURIComponent(proposalId)}`;
  return resource ? `${base}/${resource}` : base;
}
