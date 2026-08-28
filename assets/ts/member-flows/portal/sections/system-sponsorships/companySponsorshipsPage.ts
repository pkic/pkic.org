import type { SponsorshipsListResponse } from "../../../../../shared/schemas/sponsorship-management";

/**
 * Decomposes a company list row's `key` (built server-side in
 * `listSponsorshipCompanies`) back into the filter the detail panel needs
 * to fetch that company's sponsorships — organization/non-member-name/
 * contact-name, matching the same fallback order the grouping query uses.
 */
export function companyDetailParams(key: string): Record<string, string> {
  if (key.startsWith("org:")) return { organizationId: key.slice("org:".length) };
  if (key.startsWith("nonmember:")) return { nonMemberName: key.slice("nonmember:".length) };
  if (key.startsWith("contact:")) return { contactName: key.slice("contact:".length) };
  return {};
}

export const COMPANY_SPONSORSHIPS_PAGE_SIZE = 200;

/** Builds the bounded, offset-paginated fetch URL for one company's sponsorships page. */
export function buildCompanySponsorshipsUrl(
  companyKey: string,
  filters: { type?: string; stage?: string },
  offset: number,
): string {
  const params = new URLSearchParams({
    ...companyDetailParams(companyKey),
    limit: String(COMPANY_SPONSORSHIPS_PAGE_SIZE),
    offset: String(offset),
  });
  if (filters.type) params.set("type", filters.type);
  if (filters.stage) params.set("stage", filters.stage);
  return `/api/v1/sponsorships?${params.toString()}`;
}

/**
 * Appends a fetched page onto the previously-loaded rows for offset > 0
 * ("Load more"), or replaces them outright for a fresh offset-0 load —
 * never silently drops rows beyond the first page (PR #1 review Phase 7.2).
 */
export function mergeCompanySponsorshipsPage(
  previousSponsorships: SponsorshipsListResponse["sponsorships"],
  offset: number,
  fetched: SponsorshipsListResponse,
): SponsorshipsListResponse {
  return {
    sponsorships: offset === 0 ? fetched.sponsorships : [...previousSponsorships, ...fetched.sponsorships],
    page: fetched.page,
  };
}
