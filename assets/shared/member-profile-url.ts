/**
 * Where a member's public page lives — decided once, for every surface.
 *
 * Issue #15: `/members/profile/?id=efeb58e2-1b8f-43fa-9464-e84f6d536305` is
 * not an address anybody can read, remember, or link to on purpose. The
 * answer is the address these pages already had while they were Hugo pages:
 * `/members/keyfactor/`. That shape is not a preference — members link to
 * their profile from their own sites, and search engines have indexed it, so
 * keeping it means nothing outside this repository has to change and nothing
 * has to be redirected. `functions/members/[slug].ts` serves it.
 *
 * The query-string form survives for one case only: an individual member with
 * no `organizations` row has nowhere to hold a slug, so their page is keyed by
 * id. Three surfaces had each written that rule for themselves — the wall in
 * SQL, the directory in TSX, and the group roster in TSX with a *different*
 * fallback (the member's own website, or no link at all) — which is three
 * answers to one question.
 */

/** The shell page that resolves `?id=`; also `/members/<slug>`'s own source. */
export const MEMBER_PROFILE_SHELL_PATH = "/members/profile/";

export interface MemberProfileIdentifiers {
  id: string;
  /** `organizations.slug`; null for an individual with no organization row. */
  slug?: string | null;
}

/** The public page for one member of the consortium. */
export function memberProfileHref(member: MemberProfileIdentifiers): string {
  if (member.slug) return `/members/${encodeURIComponent(member.slug)}/`;
  return `${MEMBER_PROFILE_SHELL_PATH}?id=${encodeURIComponent(member.id)}`;
}
