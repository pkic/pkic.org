import { INDIVIDUAL_MEMBERSHIP_CATEGORIES } from "./schemas/membership-categories";
import { publicPageSlugBase } from "./schemas/public-page-slug";

/** The legacy query-based profile resolver. */
export const MEMBER_PROFILE_SHELL_PATH = "/members/profile/";

export interface MemberProfileIdentifiers {
  id: string;
  slug?: string | null;
  name?: string;
  memberType?: string;
}

/** A stable, compact identifier keeps namesakes distinct regardless of directory order. */
function independentMemberSuffix(id: string): string {
  let hash = 14695981039346656037n;
  for (const character of id) {
    hash ^= BigInt(character.charCodeAt(0));
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return hash.toString(36);
}

/** One canonical public address for directory cards, publication, and legacy redirects. */
export function memberProfileHref(member: MemberProfileIdentifiers): string {
  if (member.memberType && INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(member.memberType)) {
    const name = publicPageSlugBase(member.name ?? "", "member")
      .slice(0, 60)
      .replace(/-+$/u, "");
    return `/members/independent/${name}-${independentMemberSuffix(member.id)}/`;
  }
  return `/members/${encodeURIComponent(member.slug || member.id)}/`;
}
