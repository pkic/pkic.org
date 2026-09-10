/**
 * Decomposes a company list row's `key` (built server-side in
 * `listSponsorshipCompanies`) back into the filter that names that company on
 * the sponsorships list, matching the same fallback order the grouping query
 * uses: organization, then the non-member's own name, then the contact's, and
 * finally the sponsorship itself for a row that carries none of them.
 *
 * Every branch produces a filter the list endpoint already takes, so a
 * company's page is one bounded D1 query like every other list — the browser
 * narrows nothing itself.
 */
export function companyDetailParams(key: string): Record<string, string> {
  if (key.startsWith("org:")) return { organizationId: key.slice("org:".length) };
  if (key.startsWith("nonmember:")) return { nonMemberName: key.slice("nonmember:".length) };
  if (key.startsWith("contact:")) return { contactName: key.slice("contact:".length) };
  if (key.startsWith("sponsorship:")) return { sponsorshipId: key.slice("sponsorship:".length) };
  return {};
}
